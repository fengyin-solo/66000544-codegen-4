import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import axios from 'axios'
import type { AnalysisResult, AlertRule, LogEntry, AnomalyScore, Alert } from '@/types'
import { canonLevel, windowLevelMap, windowScopedTotal } from '@/lib/caliber'

export const useLogStore = defineStore('log', () => {
  const result = ref<AnalysisResult | null>(null)
  const loading = ref(false)
  const searchQuery = ref('')
  const logType = ref('nginx')
  const rules = ref<AlertRule[]>([
    { id:1, name:'高频ERROR', type:'level', threshold:5, enabled:true },
    { id:2, name:'异常流量', type:'count', threshold:200, enabled:false },
    { id:3, name:'关键词命中', type:'keyword', threshold:0, enabled:true }
  ])

  // —— 全局共享口径：来源 + 窗口区间（各面板共用同一份取值）——
  /** null = 全部来源；否则只观察指定来源 */
  const sourceFilter = ref<string | null>(null)
  /** 输入框中的区间起止（字符串，允许临时为空） */
  const rangeStartInput = ref<number | null>(null)
  const rangeEndInput = ref<number | null>(null)
  /** 已生效的区间（null 表示默认全覆盖）；输入填反/为空时保持上一次取值 */
  const rangeApplied = ref<{ start: number | null; end: number | null }>({ start: null, end: null })
  const rangeError = ref('')

  const windowCount = computed(() => result.value?.windows.length ?? 0)
  const allSources = computed(() => {
    const s = new Set<string>()
    result.value?.windows.forEach(w => Object.keys(w.sources).forEach(x => s.add(x)))
    return Array.from(s).sort()
  })
  const allLevels = computed(() => {
    const s = new Set<string>()
    result.value?.windows.forEach(w => {
      Object.keys(windowLevelMap(w, null)).forEach(l => s.add(canonLevel(l)))
    })
    return Array.from(s)
  })

  /** 区间生效后的窗口下标（右闭）；越界在校验阶段拦截，这里不再悄悄夹取值 */
  const effectiveRange = computed(() => {
    const max = Math.max(0, windowCount.value - 1)
    const s = Math.max(0, rangeApplied.value.start ?? 0)
    const e = Math.min(max, rangeApplied.value.end ?? max)
    return { start: s, end: Math.max(s, e) }
  })
  const scopedWindowIndexes = computed(() => {
    const { start, end } = effectiveRange.value
    const out: number[] = []
    for (let i = start; i <= end; i++) out.push(i)
    return out
  })
  const scopedWindows = computed(() => {
    const ws = result.value?.windows ?? []
    return scopedWindowIndexes.value.map(i => ws[i]).filter(Boolean)
  })

  /** 当前来源口径下，窗口 i 的级别条数 / 总条数 */
  function windowLevels(i: number): Record<string, number> {
    const w = result.value?.windows[i]
    return w ? windowLevelMap(w, sourceFilter.value) : {}
  }
  function windowTotal(i: number): number {
    const w = result.value?.windows[i]
    return w ? windowScopedTotal(w, sourceFilter.value) : 0
  }

  /** 表格日志：来源过滤在返回的日志样本上完成，并换算到对应窗口区间 */
  const filteredLogs = computed<LogEntry[]>(() => {
    const logs = result.value?.logs ?? []
    return logs.filter(l => {
      if (sourceFilter.value !== null && l.source !== sourceFilter.value) return false
      const w = Math.floor((l.id - 1) / 20)
      return w >= effectiveRange.value.start && w <= effectiveRange.value.end
    })
  })

  const scopedAnomalies = computed<AnomalyScore[]>(() => {
    const anoms = result.value?.anomalies ?? []
    const inRange = (wi: number) => wi >= effectiveRange.value.start && wi <= effectiveRange.value.end
    return anoms.filter(a => inRange(a.windowIndex))
  })

  const scopedAlerts = computed<Alert[]>(() => {
    const alerts = result.value?.alerts ?? []
    return alerts.filter(a => {
      // 老数据可能没有 windowIndex，兜底保留显示
      if (a.windowIndex === undefined) return true
      return a.windowIndex >= effectiveRange.value.start && a.windowIndex <= effectiveRange.value.end
    })
  })

  /** 各面板共用的口径说明文案，保证图例/格子/面板描述一致 */
  const caliberText = computed(() => {
    const src = sourceFilter.value === null ? '全部来源' : `来源=${sourceFilter.value}`
    const { start, end } = effectiveRange.value
    const range = windowCount.value ? `窗口 W${start}–W${end}` : '窗口 -'
    return `${src} · ${range}`
  })

  /** 提交区间输入：为空或填反时给出说明并保持上一次取值 */
  function commitRange() {
    const s = rangeStartInput.value
    const e = rangeEndInput.value
    const max = Math.max(0, windowCount.value - 1)
    if (s === null || e === null || Number.isNaN(s) || Number.isNaN(e)) {
      rangeError.value = '区间起止不能为空，已保持上一次取值'
    } else if (s > e) {
      rangeError.value = `区间起止填反（${s} > ${e}），已保持上一次取值`
    } else if (e < 0 || s > max) {
      rangeError.value = `区间超出范围（有效窗口 0–${max}），已保持上一次取值`
    } else {
      rangeError.value = ''
      rangeApplied.value = { start: s, end: e }
      return
    }
    // 校验失败：恢复上一次取值
    rangeStartInput.value = rangeApplied.value.start
    rangeEndInput.value = rangeApplied.value.end
  }

  function setSourceFilter(s: string | null) {
    sourceFilter.value = s
  }

  // 区间变化后，若选中来源在当前区间内已不存在，给出明确口径而不是留下一片空白
  watch(effectiveRange, () => {
    if (sourceFilter.value !== null && !scopedWindows.value.some(w => w.sources[sourceFilter.value as string] > 0)) {
      sourceFilter.value = null
    }
  })

  /** 重新生成/检测都会重建窗口，区间与来源口径随之恢复默认 */
  function resetCaliber() {
    sourceFilter.value = null
    rangeStartInput.value = null
    rangeEndInput.value = null
    rangeApplied.value = { start: null, end: null }
    rangeError.value = ''
  }

  async function generate() {
    loading.value=true
    try {
      const {data} = await axios.post('/api/generate',{type:logType.value,count:1000})
      result.value=data
      resetCaliber()
    }
    finally { loading.value=false }
  }

  async function detect() {
    if (!result.value) return
    loading.value=true
    try {
      const {data} = await axios.post('/api/detect',{logs:result.value.logs,rules:rules.value.filter(r=>r.enabled),query:searchQuery.value})
      result.value=data
      resetCaliber()
    }
    finally { loading.value=false }
  }

  return {
    result, loading, searchQuery, logType, rules,
    sourceFilter, rangeStartInput, rangeEndInput, rangeApplied, rangeError,
    allSources, allLevels, windowCount, effectiveRange, scopedWindowIndexes, scopedWindows,
    windowLevels, windowTotal, filteredLogs, scopedAnomalies, scopedAlerts, caliberText,
    commitRange, setSourceFilter, generate, detect
  }
})
