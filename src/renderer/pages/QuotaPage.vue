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

const chartBars = computed(() => {
  // 补齐最近 7 天（含今天），无记录补 0
  const map = new Map(days.value.map((d) => [d.day, d]))
  const out: Array<{ day: string; label: string; count: number; isToday: boolean }> = []
  const now = new Date()
  const maxCount = Math.max(1, ...days.value.map((d) => d.count))
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const row = map.get(key)
    out.push({
      day: key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      count: row?.count ?? 0,
      isToday: i === 0
    })
  }
  return { bars: out, maxCount }
})

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

    <div class="chart-title">近 7 天翻译次数</div>
    <div class="chart">
      <div v-for="b in chartBars.bars" :key="b.day" class="bar-col">
        <div class="bar-track">
          <div
            class="bar"
            :class="{ today: b.isToday }"
            :style="{ height: `${Math.max(b.count ? 4 : 0, (b.count / chartBars.maxCount) * 100)}%` }"
            :title="`${b.label}：${b.count} 次`"
          ></div>
        </div>
        <div class="bar-label" :class="{ today: b.isToday }">{{ b.label }}</div>
      </div>
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
.chart-title {
  font-size: 12.5px;
  color: var(--txt2);
  margin: 16px 0 8px;
}
.chart {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
}
.bar-col {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.bar-track {
  width: 100%;
  height: 110px;
  background: var(--card2);
  border-radius: 7px;
  display: flex;
  align-items: flex-end;
  overflow: hidden;
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
