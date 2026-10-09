#!/usr/bin/env node
// 本地实时运营数据看板（零第三方依赖，只用 node:http + Node 内置 fetch）。
//
// 为什么需要这个本地服务（别删，这是踩过的坑）：
//   云端数据库接口有来源白名单。请求「带 Origin」时，只有应用自己的域名能过，
//   其它来源一律 403 access_denied "the request origin is not allowed for this client"；
//   而「不带 Origin」反而是 200。浏览器发跨域请求必然带 Origin，所以网页无法直连云端。
//   解决办法：Node 端代理（fetch 默认不带 Origin / Referer），页面只从本地服务取数。
//
// 硬约束（被 tests/unit/dashboard.test.ts 锁死）：
//   1. 发往云端的请求绝不能带 origin / referer 头，设了反而 403；
//   2. 请求头名是 x-wb-webapp-access-key，不是 apikey；
//   3. 出错时不要把 publishable key 或内部错误细节回给页面。

import { createServer } from 'node:http'
import { exec } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** 云端应用域名。 */
export const CLOUD_ENDPOINT = 'https://game-translator.app.workbuddy.host'

/** 统计 RPC 的完整地址。 */
export const STATS_RPC_URL = CLOUD_ENDPOINT + '/.cloud/database/rest/rpc/app_stats'

/** 云端 publishable key（可公开，但仍不允许出现在回给页面的错误里）。 */
export const CLOUD_PUBLISHABLE_KEY =
  'wbpk_j7gSzC4Hd9cFphl7a2wJmo_wLuzfc9Zh2tvfBUXpw1FiIEZJQe6OUfO'

/** 默认监听地址：只绑回环，不对局域网/公网暴露。 */
export const DEFAULT_HOST = '127.0.0.1'

/** 默认端口；被占用就往上找下一个。 */
export const DEFAULT_PORT = 8787

/** 拉云端的超时时间（毫秒）。 */
export const FETCH_TIMEOUT_MS = 8000

/** 端口被占用时最多往上探测多少个。 */
export const MAX_PORT_PROBE = 30

/** 页面自动刷新间隔（毫秒）。 */
export const AUTO_REFRESH_MS = 60000

/** 趋势图最多展示的天数。 */
export const TREND_DAYS = 14

/**
 * 读取云端统计数据失败时抛出的错误。
 * message 里保证不含 publishable key。
 */
export class StatsFetchError extends Error {
  /**
   * @param {string} message 可安全展示给页面的中文提示
   * @param {string} code 机器可读的错误码
   */
  constructor(message, code = 'UPSTREAM_ERROR') {
    super(message)
    this.name = 'StatsFetchError'
    this.code = code
  }
}

/**
 * 兜底脱敏：无论错误从哪来，都不让 publishable key 出现在响应里。
 * @param {unknown} text 任意文本
 * @returns {string} 脱敏后的文本
 */
function sanitizeMessage(text) {
  const raw = String(text ?? '')
  return raw.split(CLOUD_PUBLISHABLE_KEY).join('[已隐藏]')
}

/**
 * 判断是否「请求被中止」（超时或调用方主动取消）。
 * @param {unknown} err 任意异常
 * @returns {boolean} 是否为中止错误
 */
function isAbortError(err) {
  if (!err || typeof err !== 'object') return false
  const name = /** @type {{name?: string}} */ (err).name
  return name === 'AbortError' || name === 'TimeoutError'
}

/**
 * 读取响应体文本，兼容 Response 与只有 json() 的桩实现。
 * @param {any} response fetch 的返回值
 * @returns {Promise<string>} 响应体文本
 */
async function readResponseText(response) {
  if (response && typeof response.text === 'function') {
    return await response.text()
  }
  if (response && typeof response.json === 'function') {
    return JSON.stringify(await response.json())
  }
  throw new StatsFetchError('云端接口返回了无法解析的响应', 'BAD_RESPONSE')
}

/**
 * 拉取云端 app_stats 统计。
 *
 * 注意：这里刻意不使用 src/main/services/cloud.ts 里的 fetchWithAuthOrigin——
 * 那个函数会补 Origin/Referer，补了反而被云端 403 拒掉。
 *
 * @param {{
 *   url?: string,
 *   fetchImpl?: typeof globalThis.fetch,
 *   timeoutMs?: number,
 *   signal?: AbortSignal
 * }} [options] 可选覆盖项（测试用）
 * @returns {Promise<any>} 云端返回的原始 JSON 对象
 * @throws {StatsFetchError} 超时 / 非 2xx / 非 JSON 时抛出
 */
export async function fetchAppStats(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new StatsFetchError('当前运行环境不支持 fetch，无法读取云端统计', 'NO_FETCH')
  }
  const url = options.url ?? STATS_RPC_URL
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  /** @type {((ev: Event) => void) | null} */
  const forwardAbort = options.signal
    ? () => controller.abort()
    : null
  if (options.signal && forwardAbort) {
    options.signal.addEventListener('abort', forwardAbort)
  }
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'x-wb-webapp-access-key': CLOUD_PUBLISHABLE_KEY,
        'content-type': 'application/json'
      },
      body: '',
      signal: controller.signal
    })
    const status = Number(response && response.status)
    const ok = response && response.ok !== undefined ? Boolean(response.ok) : status >= 200 && status < 300
    if (!ok) {
      throw new StatsFetchError('云端统计接口返回 HTTP ' + status, 'HTTP_' + status)
    }
    const text = await readResponseText(response)
    try {
      return JSON.parse(text)
    } catch {
      throw new StatsFetchError('云端统计接口返回了非 JSON 内容', 'BAD_JSON')
    }
  } catch (err) {
    if (err instanceof StatsFetchError) throw err
    if (isAbortError(err)) {
      throw new StatsFetchError('读取云端统计超时（超过 ' + timeoutMs + ' 毫秒）', 'TIMEOUT')
    }
    const detail = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err)
    throw new StatsFetchError('无法连接云端统计接口：' + sanitizeMessage(detail), 'NETWORK')
  } finally {
    clearTimeout(timer)
    if (options.signal && forwardAbort) {
      options.signal.removeEventListener('abort', forwardAbort)
    }
  }
}

/**
 * 把端口参数规整成合法端口号（0 表示交给系统分配）。
 * @param {unknown} value 端口入参
 * @param {number} fallback 兜底端口
 * @returns {number} 合法端口
 */
export function normalizePort(value, fallback = DEFAULT_PORT) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > 65535) return fallback
  return n
}

/**
 * 从命令行参数与环境变量里解析端口：--port=8787 / --port 8787 / PORT=8787。
 * @param {string[]} argv 命令行参数（不含 node 与脚本路径）
 * @param {NodeJS.ProcessEnv} env 环境变量
 * @param {number} fallback 兜底端口
 * @returns {number} 解析出的端口
 */
export function resolvePort(argv = [], env = process.env, fallback = DEFAULT_PORT) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? '')
    if (arg === '--port' || arg === '-p') {
      return normalizePort(argv[i + 1], fallback)
    }
    if (arg.startsWith('--port=')) {
      return normalizePort(arg.slice('--port='.length), fallback)
    }
  }
  if (env && env.PORT !== undefined && String(env.PORT).trim() !== '') {
    return normalizePort(env.PORT, fallback)
  }
  return fallback
}

/**
 * 判断错误是否是「端口不可用」（被占用或无权限）。
 * @param {unknown} err listen 抛出的错误
 * @returns {boolean} 是否该换下一个端口重试
 */
function isPortUnavailable(err) {
  const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : ''
  return code === 'EADDRINUSE' || code === 'EACCES' || code === 'EADDRNOTAVAIL'
}

/**
 * 在指定 host/port 上监听。
 * @param {import('node:http').Server} server HTTP 服务
 * @param {number} port 端口
 * @param {string} host 监听地址
 * @returns {Promise<void>} 监听成功即 resolve
 */
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    /** @param {Error} err 监听错误 */
    const onError = (err) => {
      server.removeListener('error', onError)
      reject(err)
    }
    server.once('error', onError)
    server.listen(port, host, () => {
      server.removeListener('error', onError)
      resolve()
    })
  })
}

/**
 * 从首选端口开始监听，被占用就往上找下一个可用端口。
 * port 传 0 时交由系统分配（仅探测一次）。
 * @param {import('node:http').Server} server HTTP 服务
 * @param {{ host: string, port: number, maxProbe?: number }} options 监听参数
 * @returns {Promise<number>} 实际监听到的端口
 */
export async function listenWithFallback(server, options) {
  const host = options.host || DEFAULT_HOST
  const preferred = normalizePort(options.port, DEFAULT_PORT)
  const maxProbe = options.maxProbe ?? MAX_PORT_PROBE
  /** @type {unknown} */
  let lastError = null
  for (let i = 0; i < maxProbe; i += 1) {
    const candidate = preferred === 0 ? 0 : preferred + i
    try {
      await listen(server, candidate, host)
      const addr = server.address()
      if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
        return addr.port
      }
      return candidate
    } catch (err) {
      lastError = err
      if (preferred === 0 || !isPortUnavailable(err)) break
    }
  }
  const detail = sanitizeMessage(
    lastError && typeof lastError === 'object' && 'message' in lastError
      ? String(lastError.message)
      : String(lastError ?? '未知原因')
  )
  throw new Error('无法在 ' + host + ' 上监听端口（起点 ' + preferred + '）：' + detail)
}

/**
 * 写 JSON 响应。
 * @param {import('node:http').ServerResponse} res 响应对象
 * @param {number} status HTTP 状态码
 * @param {unknown} payload 会被序列化的内容
 * @returns {void}
 */
function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(body)
}

/**
 * 写 HTML 响应。
 * @param {import('node:http').ServerResponse} res 响应对象
 * @param {string} html 页面内容
 * @returns {void}
 */
function sendHtml(res, html) {
  const body = Buffer.from(html, 'utf8')
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(body)
}

/**
 * 处理单个 HTTP 请求。
 * @param {import('node:http').IncomingMessage} req 请求
 * @param {import('node:http').ServerResponse} res 响应
 * @param {{ fetchStats: () => Promise<any> }} ctx 取数函数
 * @returns {Promise<void>} 处理完成
 */
async function handleRequest(req, res, ctx) {
  const method = String(req.method ?? 'GET').toUpperCase()
  let pathname = '/'
  try {
    pathname = new URL(req.url ?? '/', 'http://' + (req.headers.host ?? DEFAULT_HOST)).pathname
  } catch {
    pathname = '/'
  }

  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: '只看不改：本服务只接受 GET 请求' })
    return
  }

  if (pathname === '/' || pathname === '/index.html') {
    const html = renderDashboardHtml()
    if (method === 'HEAD') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end()
      return
    }
    sendHtml(res, html)
    return
  }

  if (pathname === '/api/stats') {
    try {
      const data = await ctx.fetchStats()
      if (method === 'HEAD') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end()
        return
      }
      sendJson(res, 200, data ?? {})
    } catch (err) {
      const known = err instanceof StatsFetchError ? err : null
      const message = known ? known.message : '读取云端统计数据失败，请稍后重试'
      const code = known ? known.code : 'UPSTREAM_ERROR'
      if (method === 'HEAD') {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
        res.end()
        return
      }
      sendJson(res, 502, { error: sanitizeMessage(message), code })
    }
    return
  }

  sendJson(res, 404, { error: '没有这个地址', code: 'NOT_FOUND' })
}

/**
 * 创建看板 HTTP 服务（已绑定端口，可直接用）。
 *
 * @param {{
 *   host?: string,
 *   port?: number,
 *   maxPortProbe?: number,
 *   fetchStats?: () => Promise<any>,
 *   fetchImpl?: typeof globalThis.fetch,
 *   timeoutMs?: number,
 *   url?: string
 * }} [options] 可选覆盖项
 * @returns {Promise<{
 *   server: import('node:http').Server,
 *   port: number,
 *   host: string,
 *   url: string,
 *   close: () => Promise<void>
 * }>} 服务句柄
 */
export async function createDashboardServer(options = {}) {
  const host = options.host ?? DEFAULT_HOST
  const port = normalizePort(options.port ?? DEFAULT_PORT, DEFAULT_PORT)
  const fetchStats =
    options.fetchStats ??
    (() =>
      fetchAppStats({
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        url: options.url
      }))
  const server = createServer((req, res) => {
    handleRequest(req, res, { fetchStats }).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: '本地看板内部错误', code: 'INTERNAL' })
      res.end()
    })
  })
  const boundPort = await listenWithFallback(server, {
    host,
    port,
    maxProbe: options.maxPortProbe
  })
  return {
    server,
    port: boundPort,
    host,
    url: 'http://' + host + ':' + boundPort + '/',
    /**
     * 关闭服务。
     * @returns {Promise<void>} 关闭完成
     */
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
      })
  }
}

/**
 * 尝试用系统默认浏览器打开地址；失败就静默（启动流程不应因此崩掉）。
 * @param {string} url 要打开的地址
 * @returns {void}
 */
export function openBrowser(url) {
  try {
    const target = url.replace(/"/g, '')
    const command =
      process.platform === 'win32'
        ? 'start "" "' + target + '"'
        : process.platform === 'darwin'
          ? 'open "' + target + '"'
          : 'xdg-open "' + target + '"'
    exec(command, () => undefined)
  } catch {
    // 打不开就算了，地址已经打印在终端里
  }
}

/**
 * 启动看板服务（命令行入口）。
 * @param {string[]} argv 命令行参数
 * @returns {Promise<{ port: number, host: string, url: string, close: () => Promise<void> }>} 句柄
 */
export async function startDashboard(argv = []) {
  const port = resolvePort(argv, process.env, DEFAULT_PORT)
  const handle = await createDashboardServer({ port })
  if (handle.port !== port && port !== 0) {
    console.log('端口 ' + port + ' 已被占用，改用 ' + handle.port)
  }
  console.log('游戏翻译助手 · 运营数据看板已启动')
  console.log('  本地地址：' + handle.url)
  console.log('  按 Ctrl+C 停止')
  openBrowser(handle.url)
  const stop = () => {
    handle.close().then(() => process.exit(0))
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return handle
}

/** 内联的看板页面（CSS/JS 全内联，不引任何 CDN，可离线查看）。 */
export function renderDashboardHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>游戏翻译助手 · 运营数据</title>
<style>
  :root {
    --bg: #161A21;
    --card: #1D232D;
    --line: #2D3543;
    --gold: #F2B24C;
    --teal: #3CC7AB;
    --text: #E7EAF0;
    --dim: #9AA4B4;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 28px 20px 48px; }
  .top {
    display: flex; flex-wrap: wrap; gap: 12px;
    align-items: flex-end; justify-content: space-between;
    padding-bottom: 18px; border-bottom: 1px solid var(--line);
  }
  .top h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: .5px; }
  .top .sub { margin: 6px 0 0; color: var(--dim); font-size: 12px; }
  .top-right { display: flex; align-items: center; gap: 12px; }
  .stamp { color: var(--dim); font-size: 12px; }
  .stamp b { color: var(--text); font-weight: 600; }
  button {
    background: var(--card); color: var(--text);
    border: 1px solid var(--line); border-radius: 6px;
    padding: 7px 16px; font-size: 13px; cursor: pointer;
    font-family: inherit;
  }
  button:hover:not(:disabled) { border-color: var(--gold); color: var(--gold); }
  button:disabled { opacity: .55; cursor: default; }
  .error {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    margin-top: 16px; padding: 12px 14px;
    border: 1px solid rgba(242, 178, 76, .45);
    background: rgba(242, 178, 76, .08);
    border-radius: 8px; color: var(--gold); font-size: 13px;
  }
  .error[hidden] { display: none; }
  .cards {
    display: grid; gap: 14px; margin-top: 18px;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }
  .card {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 10px; padding: 16px 16px 14px;
  }
  .card-value { font-size: 30px; font-weight: 600; color: var(--gold); letter-spacing: 1px; }
  .card.teal .card-value { color: var(--teal); }
  .card-label { margin-top: 4px; color: var(--text); font-size: 13px; }
  .card-note { margin-top: 8px; color: var(--dim); font-size: 11px; line-height: 1.4; }
  .panel {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 10px; padding: 16px 18px 18px; margin-top: 16px;
  }
  .panel-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; margin-bottom: 10px;
  }
  .panel-head h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .legend { display: flex; gap: 14px; color: var(--dim); font-size: 12px; }
  .legend i {
    display: inline-block; width: 10px; height: 10px;
    border-radius: 2px; margin-right: 6px; vertical-align: middle;
  }
  .chart svg { display: block; width: 100%; height: auto; }
  .empty { padding: 26px 0; text-align: center; color: var(--dim); font-size: 13px; }
  .vrow {
    display: grid; grid-template-columns: 110px 1fr 72px;
    align-items: center; gap: 12px; padding: 7px 0;
  }
  .vrow + .vrow { border-top: 1px solid rgba(45, 53, 67, .6); }
  .vname { font-size: 13px; }
  .vbar { height: 8px; background: rgba(45, 53, 67, .8); border-radius: 4px; overflow: hidden; }
  .vfill { display: block; height: 100%; background: var(--teal); border-radius: 4px; }
  .vcount { text-align: right; color: var(--dim); font-size: 12px; }
  .foot { margin-top: 18px; color: var(--dim); font-size: 11px; text-align: center; }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <h1>游戏翻译助手 · 运营数据</h1>
      <p class="sub">本地代理读取云端统计 · 每 60 秒自动刷新 · 不含任何用户个人信息</p>
    </div>
    <div class="top-right">
      <div class="stamp">数据更新：<b id="updated">—</b></div>
      <button id="refresh" type="button">刷新</button>
    </div>
  </header>

  <div class="error" id="error" hidden>
    <span id="error-text"></span>
    <button id="retry" type="button">重试</button>
  </div>

  <section class="cards" id="cards"></section>

  <section class="panel">
    <div class="panel-head">
      <h2>近 14 天趋势</h2>
      <div class="legend">
        <span><i style="background:#F2B24C"></i>活跃用户</span>
        <span><i style="background:#3CC7AB"></i>登录次数</span>
      </div>
    </div>
    <div class="chart" id="chart"><div class="empty">加载中…</div></div>
  </section>

  <section class="panel">
    <div class="panel-head"><h2>版本分布</h2></div>
    <div id="versions"><div class="empty">加载中…</div></div>
  </section>

  <p class="foot">数据来自云端 app_stats 聚合接口，仅统计人数与次数，不展示邮箱、昵称或用户标识。</p>
</div>
<script>
(function () {
  'use strict';
  var REFRESH_MS = 60000;
  var GOLD = '#F2B24C';
  var TEAL = '#3CC7AB';
  var GRID = '#2D3543';
  var DIM = '#9AA4B4';

  var updatedEl = document.getElementById('updated');
  var refreshBtn = document.getElementById('refresh');
  var retryBtn = document.getElementById('retry');
  var errorEl = document.getElementById('error');
  var errorTextEl = document.getElementById('error-text');
  var cardsEl = document.getElementById('cards');
  var chartEl = document.getElementById('chart');
  var versionsEl = document.getElementById('versions');
  var loading = false;

  function svg(name, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, String(attrs[k]));
    }
    return node;
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function pad2(v) { return v < 10 ? '0' + v : String(v); }

  function fmtInt(v) { return String(Math.round(num(v))); }

  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function dayShort(day) {
    var s = String(day || '');
    return s.length > 5 ? s.slice(5) : s;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function empty(host, text) {
    clear(host);
    var box = document.createElement('div');
    box.className = 'empty';
    box.textContent = text;
    host.appendChild(box);
  }

  function makeCard(label, value, note, teal) {
    var card = document.createElement('div');
    card.className = 'card' + (teal ? ' teal' : '');
    var v = document.createElement('div');
    v.className = 'card-value';
    v.textContent = fmtInt(value);
    var l = document.createElement('div');
    l.className = 'card-label';
    l.textContent = label;
    card.appendChild(v);
    card.appendChild(l);
    if (note) {
      var n = document.createElement('div');
      n.className = 'card-note';
      n.textContent = note;
      card.appendChild(n);
    }
    return card;
  }

  function renderCards(data) {
    clear(cardsEl);
    var items = [
      { label: '注册用户', value: data.registeredUsers, teal: false,
        note: '管理端写入于 ' + fmtDate(data.registeredAt) + ' · 非实时自增' },
      { label: '今日活跃', value: data.todayUsers, teal: true },
      { label: '今日登录次数', value: data.todayLogins, teal: false },
      { label: '7 日活跃', value: data.active7d, teal: true },
      { label: '30 日活跃', value: data.active30d, teal: false },
      { label: '云端配置用户', value: data.syncedUsers, teal: true,
        note: '存过云端配置的用户数' }
    ];
    for (var i = 0; i < items.length; i++) {
      cardsEl.appendChild(makeCard(items[i].label, items[i].value, items[i].note, items[i].teal));
    }
  }

  function addBar(root, x, value, max, plotH, padT, bw, color, name) {
    var h = Math.round((plotH * value) / max);
    if (value > 0 && h < 2) h = 2;
    if (h <= 0) return;
    var rect = svg('rect', {
      x: x, y: padT + plotH - h, width: bw, height: h, rx: 2, fill: color
    });
    var tip = svg('title');
    tip.textContent = dayName(name) + ' ' + value;
    rect.appendChild(tip);
    root.appendChild(rect);
  }

  function dayName(name) { return name; }

  function renderChart(trend) {
    var rows = [];
    if (Object.prototype.toString.call(trend) === '[object Array]') {
      for (var i = 0; i < trend.length && rows.length < 14; i++) {
        var d = trend[i] || {};
        rows.push({ day: String(d.day || ''), users: num(d.users), logins: num(d.logins) });
      }
    }
    if (rows.length === 0) {
      empty(chartEl, '暂无趋势数据');
      return;
    }
    var max = 1;
    for (var m = 0; m < rows.length; m++) {
      max = Math.max(max, rows[m].users, rows[m].logins);
    }
    var W = 760, H = 260, padL = 44, padR = 14, padT = 18, padB = 36;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', preserveAspectRatio: 'none' });
    for (var g = 0; g <= 4; g++) {
      var frac = g / 4;
      var y = padT + plotH - plotH * frac;
      root.appendChild(svg('line', {
        x1: padL, y1: y, x2: W - padR, y2: y, stroke: GRID,
        'stroke-width': 1, 'stroke-dasharray': g === 0 ? '0' : '3 4'
      }));
      var tick = svg('text', {
        x: padL - 10, y: y + 4, fill: DIM, 'font-size': 11, 'text-anchor': 'end'
      });
      tick.textContent = String(Math.round(max * frac));
      root.appendChild(tick);
    }
    var gw = plotW / rows.length;
    var bw = Math.max(5, Math.min(18, gw * 0.3));
    for (var r = 0; r < rows.length; r++) {
      var cx = padL + gw * r + gw / 2;
      addBar(root, cx - bw - 2, rows[r].users, max, plotH, padT, bw, GOLD, '活跃用户');
      addBar(root, cx + 2, rows[r].logins, max, plotH, padT, bw, TEAL, '登录次数');
      var lab = svg('text', {
        x: cx, y: H - 16, fill: DIM, 'font-size': 11, 'text-anchor': 'middle'
      });
      lab.textContent = dayShort(rows[r].day);
      root.appendChild(lab);
    }
    clear(chartEl);
    chartEl.appendChild(root);
  }

  function renderVersions(versions) {
    var list = Object.prototype.toString.call(versions) === '[object Array]' ? versions : [];
    if (list.length === 0) {
      empty(versionsEl, '暂无版本数据');
      return;
    }
    var max = 1;
    for (var i = 0; i < list.length; i++) {
      max = Math.max(max, num((list[i] || {}).users));
    }
    clear(versionsEl);
    for (var j = 0; j < list.length; j++) {
      var item = list[j] || {};
      var row = document.createElement('div');
      row.className = 'vrow';
      var name = document.createElement('span');
      name.className = 'vname';
      name.textContent = String(item.version || '未知版本');
      var bar = document.createElement('span');
      bar.className = 'vbar';
      var fill = document.createElement('span');
      fill.className = 'vfill';
      fill.style.width = Math.max(4, Math.round((num(item.users) / max) * 100)) + '%';
      bar.appendChild(fill);
      var cnt = document.createElement('span');
      cnt.className = 'vcount';
      cnt.textContent = fmtInt(item.users) + ' 人';
      row.appendChild(name);
      row.appendChild(bar);
      row.appendChild(cnt);
      versionsEl.appendChild(row);
    }
  }

  function showError(message) {
    if (!message) {
      errorEl.hidden = true;
      errorTextEl.textContent = '';
      return;
    }
    errorTextEl.textContent = message;
    errorEl.hidden = false;
  }

  function render(data) {
    var safe = data && typeof data === 'object' ? data : {};
    updatedEl.textContent = fmtTime(safe.updatedAt);
    renderCards(safe);
    renderChart(safe.trend);
    renderVersions(safe.versions);
  }

  function load() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    refreshBtn.textContent = '刷新中…';
    fetch('/api/stats', { headers: { accept: 'application/json' } }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          var msg = (body && body.error) ? body.error : '云端统计接口返回 HTTP ' + res.status;
          throw new Error(msg);
        });
      }
      return res.json();
    }).then(function (data) {
      showError(null);
      render(data);
    }).catch(function (err) {
      showError(err && err.message ? err.message : '读取云端统计数据失败，请稍后重试');
    }).then(function () {
      loading = false;
      refreshBtn.disabled = false;
      refreshBtn.textContent = '刷新';
    });
  }

  refreshBtn.addEventListener('click', load);
  retryBtn.addEventListener('click', load);
  window.setInterval(load, REFRESH_MS);
  load();
})();
</script>
</body>
</html>
`
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  startDashboard(process.argv.slice(2)).catch((err) => {
    console.error('看板启动失败：' + sanitizeMessage(err && err.message ? err.message : String(err)))
    process.exit(1)
  })
}
