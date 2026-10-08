// 校验 app.asar 内容：确认没有本机数据/开发文件混入，且关键代码已进包
// 用法：node scripts/verify-asar.mjs <app.asar 路径> [要检查的字符串...]
import fs from 'node:fs'

const asarPath = process.argv[2]
const needles = process.argv.slice(3)
if (!asarPath) {
  console.error('用法：node scripts/verify-asar.mjs <app.asar> [字符串...]')
  process.exit(1)
}

const buf = fs.readFileSync(asarPath)
const start = buf.indexOf(Buffer.from('{"files"'))
if (start < 0) throw new Error('未找到 asar header')

// 按 JSON 括号配对找到 header 结束位置
let depth = 0
let end = -1
let inStr = false
let esc = false
for (let i = start; i < buf.length; i++) {
  const c = buf[i]
  if (inStr) {
    if (esc) esc = false
    else if (c === 0x5c /* \ */) esc = true
    else if (c === 0x22 /* " */) inStr = false
    continue
  }
  if (c === 0x22) {
    inStr = true
  } else if (c === 0x7b /* { */) {
    depth++
  } else if (c === 0x7d /* } */) {
    depth--
    if (depth === 0) {
      end = i + 1
      break
    }
  }
}
if (end < 0) throw new Error('asar header 解析失败')
const header = JSON.parse(buf.toString('utf8', start, end))

const files = []
let totalSize = 0
function walk(node, prefix) {
  for (const [name, v] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name
    if (v.files) {
      walk(v, p)
    } else {
      files.push(p)
      totalSize += Number(v.size ?? 0)
    }
  }
}
walk(header, '')

// 顶层项目文件才做“不得进包”检查：node_modules 是运行时依赖，其目录名不参与判定
const topLevelForbidden = /^(src|tests|coverage|scripts|dist|dist-pkg\d*|releases)\//
const bad = files.filter((f) => {
  if (/\.(db|db-wal|db-shm|sqlite|sqlite3|log)$/i.test(f)) return true
  if (/(^|\/)\.dev-build$/.test(f)) return true
  if (f === 'settings.local.json') return true
  if (topLevelForbidden.test(f)) return true
  if (/^tsconfig.*\.json$/.test(f)) return true
  if (/^vitest\.config\.(js|ts|mjs|cjs)$/.test(f)) return true
  return false
})

console.log(`asar: ${asarPath}`)
console.log(`文件数: ${files.length}  声明总大小: ${totalSize} bytes`)
console.log(`可疑文件(本机数据/开发文件): ${bad.length ? '\n  ' + bad.join('\n  ') : '无'}`)

if (needles.length) {
  const text = buf.toString('utf8')
  console.log('关键字符串检查:')
  for (const s of needles) {
    console.log(`  ${text.includes(s) ? 'OK ' : 'MISS'}  ${s}`)
  }
}

process.exitCode = bad.length ? 1 : 0
