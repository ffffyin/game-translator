<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import type { ModelConfigView } from '../../shared/model'
import type { QuotaResult, UsageTotals, UsageDay } from '../../shared/api-contract'

const models = ref<ModelConfigView[]>([])
const quotas = ref<Map<number, QuotaResult>>(new Map())
const loadingAll = ref(false)
const loadingId = ref<number | null>(null)

const totals = ref<UsageTotals>({ count: 0, chars: 0, tokens_in: 0, tokens_out: 0 })
const today = ref<UsageTotals>({ count: 0, chars: 0, tokens_in: 0, tokens_out: 0 })
const byConfig = ref<Array<{ name: string; count: number; chars: number }>>([])
const days = ref<UsageDay[]>([])

// 柱高指标：次数 / 字符 / Tokens，切换后按对应用量重新归一化
type MetricKey = 'count' | 'chars' | 'tokens'
const METRIC_OPTIONS: Array<{ key: MetricKey; label: string; unit: string }> = [
  { key: 'count', label: '次数', unit: '次' },
  { key: 'chars', label: '字符', unit: '字符' },
  { key: 'tokens', label: 'Tokens', unit: 'tokens' }
]
const metric = ref<MetricKey>('count')
const activeMetric = computed(
  () => METRIC_OPTIONS.find((m) => m.key === metric.value) ?? METRIC_OPTIONS[0]
)

// 本地日期 key：toISOString() 是 UTC 日期，北京时间 00:00-08:00 会算成昨天，导致"今天"取到昨天的数据
function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN')
}

const chartBars = computed(() => {
  // 补齐最近 7 天（含今天），无记录补 0
  const map = new Map(days.value.map((d) => [d.day, d]))
  const now = new Date()
  const out: Array<{
    day: string
    label: string
    count: number
    chars: number
    tokens: number
    isToday: boolean
    value: number
  }> = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const key = localDayKey(d)
    const row = map.get(key)
    const count = row?.count ?? 0
    const chars = row?.chars ?? 0
    const tokens = (row?.tokens_in ?? 0) + (row?.tokens_out ?? 0)
    out.push({
      day: key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      count,
      chars,
      tokens,
      isToday: i === 0,
      value: metric.value === 'count' ? count : metric.value === 'chars' ? chars : tokens
    })
  }
  const max = Math.max(0, ...out.map((b) => b.value))
  const peak = max > 0 ? out.find((b) => b.value === max)! : null
  return { bars: out, max, peak }
})

// 柱高按用量比例；非零值给最小高度，避免小用量看不见
function barHeight(value: number): string {
  if (chartBars.value.max <= 0 || value <= 0) return '0%'
  return `${Math.max(6, (value / chartBars.value.max) * 100)}%`
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`
}

async function refreshOne(id: number): Promise<void> {
  loadingId.value = id
  try {
    const r = await window.api.quotaQuery(id)
    quotas.value.set(id, r)
    quotas.value = new Map(quotas.value)
  } finally {
    loadingId.value = null
  }
}

async function refreshAll(): Promise<void> {
  loadingAll.value = true
  try {
    const rs = await window.api.quotaQueryAll()
    quotas.value = new Map(rs.map((r) => [r.configId, r]))
  } finally {
    loadingAll.value = false
  }
}

async function loadUsage(): Promise<void> {
  totals.value = await window.api.usageTotals()
  today.value = await window.api.usageTotalsToday()
  byConfig.value = await window.api.usageByConfig()
  days.value = await window.api.usageAggregateDays(7)
}

onMounted(async () => {
  models.value = await window.api.modelsList()
  await Promise.all([refreshAll(), loadUsage()])
})
</script>

<template>
  <PageHeader title="AI 模型额度" note="查询各模型 API 余额，统计本机翻译用量" />

  <div class="m-card">
    <div class="card-head">
      <div class="lab">API 余额</div>
      <button class="accent sm" :disabled="loadingAll" @click="refreshAll">
        {{ loadingAll ? '查询中…' : '全部刷新' }}
      </button>
    </div>

    <div v-if="models.length === 0" class="empty">还没有模型，先去「AI 模型配置」添加</div>

    <div class="quota-grid">
      <div v-for="m in models" :key="m.id" class="quota-card">
        <div class="qc-head">
          <b>{{ m.name }}</b>
          <button
            class="link sm"
            :disabled="loadingId === m.id"
            @click="refreshOne(m.id)"
          >
            {{ loadingId === m.id ? '…' : '查询' }}
          </button>
        </div>
        <div class="qc-sub">{{ m.provider }} · {{ m.text_model }}</div>

        <template v-if="quotas.get(m.id)">
          <div v-if="!quotas.get(m.id)!.supported" class="qc-unsupported">
            该厂商未开放余额查询
          </div>
          <div v-else-if="quotas.get(m.id)!.error" class="qc-error">
            {{ quotas.get(m.id)!.error }}
          </div>
          <template v-else>
            <div class="qc-balance">{{ quotas.get(m.id)!.balanceText }}</div>
            <div v-if="quotas.get(m.id)!.expiresAt" class="qc-meta">
              有效期至 {{ fmtTime(quotas.get(m.id)!.expiresAt!) }}
            </div>
          </template>
          <div class="qc-meta">查询于 {{ fmtTime(quotas.get(m.id)!.checkedAt) }}</div>
        </template>
        <div v-else class="qc-meta">尚未查询</div>
      </div>
    </div>
  </div>

  <div class="m-card">
    <div class="lab">本机用量</div>
    <div class="stat-grid">
      <div class="stat">
        <b>{{ today.count }}</b>
        <span>今日次数</span>
      </div>
      <div class="stat">
        <b>{{ totals.count }}</b>
        <span>累计次数</span>
      </div>
      <div class="stat">
        <b>{{ totals.chars }}</b>
        <span>累计字符</span>
      </div>
      <div class="stat">
        <b>{{ totals.tokens_in + totals.tokens_out }}</b>
        <span>累计 Tokens</span>
      </div>
    </div>

    <div class="chart-head">
      <div class="chart-title">近 7 天{{ activeMetric.label }}</div>
      <div class="metric-tabs">
        <button
          v-for="m in METRIC_OPTIONS"
          :key="m.key"
          class="metric-tab"
          :class="{ on: metric === m.key }"
          @click="metric = m.key"
        >
          {{ m.label }}
        </button>
      </div>
    </div>

    <div class="chart">
      <div
        v-for="b in chartBars.bars"
        :key="b.day"
        class="bar-col"
        :class="{ today: b.isToday }"
      >
        <div class="tt">
          <b>{{ b.label }}{{ b.isToday ? ' · 今天' : '' }}</b>
          <span>{{ fmtNum(b.count) }} 次</span>
          <span>{{ fmtNum(b.chars) }} 字符</span>
          <span>{{ fmtNum(b.tokens) }} tokens</span>
        </div>
        <div class="bar-track">
          <div
            class="bar"
            :class="{ today: b.isToday }"
            :style="{ height: barHeight(b.value) }"
          ></div>
        </div>
        <div class="bar-num" :class="{ today: b.isToday }">
          {{ b.value > 0 ? fmtNum(b.value) : '–' }}
        </div>
        <div class="bar-label" :class="{ today: b.isToday }">{{ b.label }}</div>
      </div>
    </div>

    <div v-if="chartBars.max === 0" class="chart-empty">
      最近 7 天还没有翻译记录，翻译几次后这里就会长出柱子
    </div>
    <div v-else class="chart-foot">
      峰值 <b>{{ fmtNum(chartBars.max) }} {{ activeMetric.unit }}</b>
      <template v-if="chartBars.peak">（{{ chartBars.peak.label }}）</template>
      · 鼠标悬停柱子可查看当天次数 / 字符 / Tokens
    </div>

    <table v-if="byConfig.length" class="mini-table">
      <thead>
        <tr>
          <th>模型</th>
          <th>次数</th>
          <th>字符</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in byConfig" :key="r.name">
          <td>{{ r.name }}</td>
          <td>{{ r.count }}</td>
          <td>{{ r.chars }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">暂无用量记录</div>
  </div>
</template>

<style scoped>
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sm {
  font-size: 12px;
  padding: 5px 12px;
}
.quota-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.quota-card {
  background: var(--card2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 13px;
}
.qc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.qc-head b {
  font-size: 13px;
}
.qc-sub {
  font-size: 11px;
  color: var(--txt3);
  margin: 2px 0 8px;
}
.qc-balance {
  font-size: 20px;
  font-weight: 700;
  color: var(--accent);
}
.qc-meta {
  font-size: 11px;
  color: var(--txt3);
  margin-top: 4px;
}
.qc-unsupported {
  font-size: 12.5px;
  color: var(--txt3);
  background: var(--card);
  border-radius: 7px;
  padding: 7px 9px;
}
.qc-error {
  font-size: 12px;
  color: var(--danger);
  background: var(--danger-soft);
  border-radius: 7px;
  padding: 7px 9px;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin: 12px 0 4px;
}
.stat {
  background: var(--card2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat b {
  font-size: 20px;
}
.stat span {
  font-size: 11.5px;
  color: var(--txt3);
}
.chart-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 16px 0 8px;
}
.chart-title {
  font-size: 12.5px;
  color: var(--txt2);
}
.metric-tabs {
  display: flex;
  gap: 6px;
}
.metric-tab {
  background: var(--card2);
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--txt3);
  font-size: 11.5px;
  padding: 4px 11px;
  cursor: pointer;
}
.metric-tab.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}
.chart {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  padding-top: 6px;
}
.bar-col {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}
/* 悬停浮层：直接显示当天的次数 / 字符 / Tokens */
.tt {
  position: absolute;
  bottom: calc(100% - 4px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 7px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  white-space: nowrap;
  font-size: 11px;
  color: var(--txt2);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease, transform 0.12s ease;
  z-index: 5;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
}
.tt b {
  color: var(--txt);
  font-size: 11.5px;
  margin-bottom: 2px;
}
.bar-col:hover .tt {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}
/* 首尾两列靠边对齐，避免浮层被容器裁掉 */
.bar-col:first-child .tt {
  left: 0;
  transform: translateY(4px);
}
.bar-col:first-child:hover .tt {
  transform: translateY(0);
}
.bar-col:last-child .tt {
  left: auto;
  right: 0;
  transform: translateY(4px);
}
.bar-col:last-child:hover .tt {
  transform: translateY(0);
}
.bar-col:hover .bar-track {
  border-color: var(--accent);
}
.bar-track {
  width: 100%;
  height: 110px;
  background: var(--card2);
  border: 1px solid transparent;
  border-radius: 7px;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
  transition: border-color 0.12s ease;
}
.bar-num {
  font-size: 10.5px;
  color: var(--txt3);
  margin-top: 5px;
  min-height: 14px;
}
.bar-num.today {
  color: var(--teal);
  font-weight: 700;
}
.chart-empty,
.chart-foot {
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--txt3);
}
.chart-foot b {
  color: var(--txt2);
}
.bar {
  width: 100%;
  background: var(--accent);
  border-radius: 6px 6px 0 0;
  transition: height 0.3s ease;
}
.bar.today {
  background: var(--teal);
}
.bar-label {
  font-size: 10.5px;
  color: var(--txt3);
  margin-top: 5px;
}
.bar-label.today {
  color: var(--teal);
  font-weight: 700;
}
.mini-table {
  width: 100%;
  margin-top: 16px;
  font-size: 12.5px;
  border-collapse: collapse;
}
.mini-table th,
.mini-table td {
  text-align: left;
  padding: 7px 8px;
  border-bottom: 1px solid var(--line);
}
.mini-table th {
  color: var(--txt3);
  font-weight: 500;
}
.empty {
  font-size: 12.5px;
  color: var(--txt3);
  padding: 14px 2px;
}
</style>
