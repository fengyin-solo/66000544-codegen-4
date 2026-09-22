<template>
  <div class="panel">
    <div class="head">
      <h4>🔥 日志级别热力图</h4>
      <div class="controls">
        <el-radio-group v-model="orient" size="small">
          <el-radio-button value="winFirst">{{ split ? '窗口 × 来源' : '窗口 × 级别' }}</el-radio-button>
          <el-radio-button value="otherFirst">{{ split ? '来源 × 窗口' : '级别 × 窗口' }}</el-radio-button>
        </el-radio-group>
        <el-tooltip :disabled="store.sourceFilter === null" content="选择「全部来源」后才能按来源拆分" placement="top">
          <span class="split-wrap">
            <el-switch v-model="split" :disabled="store.sourceFilter !== null"
                       active-text="按来源拆分" inline-prompt/>
          </span>
        </el-tooltip>
      </div>
    </div>

    <CaliberBar />

    <!-- 图例：级别色块 + 连续色阶，样式与格子相区分 -->
    <div v-if="matrix" class="legend">
      <span class="lg-title">级别：</span>
      <span v-for="lv in levels" :key="lv" class="chip">
        <i class="chip-dot" :style="{ background: LEVEL_COLORS[lv] || '#94a3b8' }"></i>{{ lv }}
      </span>
      <span class="lg-sep"></span>
      <span class="lg-title">条数色阶：</span>
      <span class="scale">
        <i class="scale-bar"></i>
        <span class="s0">0</span>
        <span class="smax">{{ matrix.maxVal }}</span>
      </span>
      <span class="lg-note">色阶上限按当前视图重算；占比 = 格内条数 ÷ 该窗口（当前来源口径）总条数（{{ store.caliberText }}）</span>
    </div>

    <div v-if="!store.result" class="placeholder">生成日志后展示热力图</div>
    <template v-else>
      <div ref="chart" class="chart" :style="{ height: chartHeight + 'px' }"></div>
      <!-- 没有数据的整行/整列给出说明 -->
      <div class="notes">
        <div v-if="matrix.emptyRows.length">⚠ 无数据的行：{{ matrix.emptyRows.join('、') }}（当前来源口径下这些行没有日志）</div>
        <div v-if="matrix.emptyCols.length">⚠ 无数据的列：{{ matrix.emptyCols.join('、') }}（当前视图/口径下这些列没有日志）</div>
        <div v-if="matrix.maxVal === 0">⚠ 当前视图所有格子均无数据；色阶上限回退为 1。</div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useLogStore } from '../store/log'
import CaliberBar from './CaliberBar.vue'
import { LEVEL_COLORS, pct, sortLevels, windowLevelMap } from '../lib/caliber'

const store = useLogStore()
const chart = ref<HTMLDivElement>()
let inst: echarts.ECharts | null = null

/** 维度切换：默认窗口在行；另一视图把另一个维度翻转到行 */
const orient = ref<'winFirst' | 'otherFirst'>('winFirst')
/** 按来源拆分：窗口 × 来源，格内逐级别列条数与占比（仅「全部来源」口径可用） */
const split = ref(false)

// 指定来源后拆分口径不再成立，自动退回级别视图
watch(() => store.sourceFilter, s => { if (s !== null) split.value = false })

const levels = computed(() => sortLevels(store.allLevels))

/** 当前区间内实际出现过的来源（拆分视图的列） */
const scopedSources = computed(() => {
  const set = new Set<string>()
  store.scopedWindows.forEach(w => Object.keys(w.sources).forEach(s => set.add(s)))
  return Array.from(set).sort()
})

interface Cell {
  x: number; y: number; value: number; total: number; empty: boolean
  detail: Record<string, number>
  tipTitle: string
}
interface Matrix {
  rowCats: string[]; colCats: string[]; rowIsLevel: boolean; colIsLevel: boolean
  cells: Cell[]
  emptyRows: string[]; emptyCols: string[]
  maxVal: number; split: boolean
}

const matrix = computed<Matrix>(() => {
  const result = store.result
  if (!result) {
    return { rowCats: [], colCats: [], rowIsLevel: false, colIsLevel: false,
             cells: [], emptyRows: [], emptyCols: [], maxVal: 0, split: split.value }
  }
  const winCats = store.scopedWindowIndexes.map(i => 'W' + i)
  const lvCats = levels.value
  const srcCats = scopedSources.value

  let rowCats: string[], colCats: string[]
  let rowIsWin: boolean, colIsLevel = false, rowIsLevel = false

  if (split.value) {
    if (orient.value === 'winFirst') { rowCats = winCats; colCats = srcCats; rowIsWin = true }
    else { rowCats = srcCats; colCats = winCats; rowIsWin = false }
  } else {
    if (orient.value === 'winFirst') { rowCats = winCats; colCats = lvCats; rowIsWin = true; colIsLevel = true }
    else { rowCats = lvCats; colCats = winCats; rowIsWin = false; rowIsLevel = true }
  }

  const cells: Cell[] = []
  const rowTotals = new Array(rowCats.length).fill(0)
  const colTotals = new Array(colCats.length).fill(0)
  let maxVal = 0

  const pushCell = (r: number, c: number, val: number, total: number,
                    detail: Record<string, number>, tipTitle: string) => {
    cells.push({ x: c, y: r, value: val, total, empty: val === 0, detail, tipTitle })
    rowTotals[r] += val
    colTotals[c] += val
    if (val > maxVal) maxVal = val
  }

  const winPositions = store.scopedWindowIndexes

  if (split.value) {
    // 窗口 × 来源：颜色=该来源在窗口内的总条数，格内逐级别列出
    winPositions.forEach((wi, wiPos) => {
      const w = result.windows[wi]
      srcCats.forEach((src, si) => {
        const detail = windowLevelMap(w, src)
        const total = w.sources[src] || 0
        const r = orient.value === 'winFirst' ? wiPos : si
        const c = orient.value === 'winFirst' ? si : wiPos
        pushCell(r, c, total, total, detail, `W${wi} · 来源 ${src}`)
      })
    })
  } else {
    // 窗口 × 级别：每个格子就是一个级别，颜色/数值=该级别条数
    winPositions.forEach((wi, wiPos) => {
      const detail = store.windowLevels(wi)
      const total = store.windowTotal(wi)
      lvCats.forEach((lv, li) => {
        const val = detail[lv] || 0
        const r = orient.value === 'winFirst' ? wiPos : li
        const c = orient.value === 'winFirst' ? li : wiPos
        pushCell(r, c, val, total, detail, `W${wi} · ${lv}`)
      })
    })
  }

  const emptyRows = rowCats.filter((_, i) => rowTotals[i] === 0)
    .map(name => split.value ? (rowIsWin ? `窗口 ${name}` : `来源 ${name}`)
                             : (rowIsWin ? `窗口 ${name}` : `级别 ${name}`))
  const emptyCols = colCats.filter((_, i) => colTotals[i] === 0)
    .map(name => split.value ? (rowIsWin ? `来源 ${name}` : `窗口 ${name}`)
                             : (colIsLevel ? `级别 ${name}` : `窗口 ${name}`))

  return { rowCats, colCats, rowIsLevel, colIsLevel, cells, emptyRows, emptyCols, maxVal, split: split.value }
})

const chartHeight = computed(() => {
  if (!store.result) return 200
  const rows = matrix.value.rowCats.length || 1
  return split.value ? Math.max(260, rows * 72 + 46) : Math.max(200, rows * 30 + 44)
})

function render() {
  if (!inst) return
  const m = matrix.value
  if (!store.result || !m.rowCats.length || !m.colCats.length) {
    inst.clear()
    return
  }

  // 逐格子的富文本标签：拆分视图逐级别列「级别 条数 占比」；普通视图两行
  const splitRich: Record<string, unknown> = {
    n: { fontSize: 7, color: '#e2e8f0' },
    p: { fontSize: 7, color: '#94a3b8' },
    e: { fontSize: 8, color: '#64748b' }
  }
  levels.value.forEach((lv, k) => {
    splitRich['l' + k] = { color: LEVEL_COLORS[lv] || '#94a3b8', fontSize: 7, fontWeight: 700 }
  })

  const data = m.cells.map(cell => {
    const darkText = m.maxVal > 0 && cell.value / m.maxVal > 0.55
    if (cell.empty) {
      return {
        value: [cell.x, cell.y, 0],
        itemStyle: { color: 'rgba(30,41,59,0.35)', borderColor: '#475569', borderWidth: 1, borderType: 'dashed' },
        label: { rich: splitRich, formatter: '{e|无数据}' },
        cx: cell
      }
    }
    const rich = m.split
      ? splitRich
      : {
          v: { fontSize: 10, fontWeight: 700, color: darkText ? '#0f172a' : '#e2e8f0' },
          q: { fontSize: 8, color: darkText ? '#334155' : '#94a3b8' }
        }
    const formatter = m.split
      ? levels.value.map((lv, k) => {
          const c = cell.detail[lv] || 0
          return `{l${k}|${lv}} {n|${c}条} {p|${pct(c, cell.total)}}`
        }).join('\n')
      : `{v|${cell.value}}\n{q|${pct(cell.value, cell.total)}}`
    return {
      value: [cell.x, cell.y, cell.value],
      itemStyle: { borderColor: '#0f172a', borderWidth: 1 },
      label: { rich, formatter },
      cx: cell
    }
  })

  const levelAxis = (cats: string[]) => cats.map(c => ({
    value: c,
    textStyle: { color: LEVEL_COLORS[c] || '#94a3b8', fontWeight: 600, fontSize: 9 }
  }))
  const plainAxis = (cats: string[]) => cats.map(c => ({ value: c, textStyle: { color: '#94a3b8', fontSize: 9 } }))

  inst.setOption({
    backgroundColor: 'transparent',
    grid: { left: 56, right: 12, top: 8, bottom: 30, containLabel: false },
    xAxis: {
      type: 'category',
      data: m.colIsLevel ? levelAxis(m.colCats) : plainAxis(m.colCats),
      axisLabel: { fontSize: 9, interval: 0 },
      axisLine: { lineStyle: { color: '#334155' } },
      splitArea: { show: false }
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: m.rowIsLevel ? levelAxis(m.rowCats) : plainAxis(m.rowCats),
      axisLabel: { fontSize: 9 },
      axisLine: { lineStyle: { color: '#334155' } }
    },
    tooltip: {
      formatter: (p: any) => {
        const cell: Cell = p.data.cx
        const rows = levels.value.map(lv => {
          const c = cell.detail[lv] || 0
          return `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;background:${LEVEL_COLORS[lv] || '#94a3b8'}"></span>` +
                 `${lv}：${c} 条（${pct(c, cell.total)}）`
        }).join('<br/>')
        return `<b>${cell.tipTitle}</b><br/>格内合计：${cell.value} 条；窗口口径总数：${cell.total} 条<hr style="border-color:#334155;margin:4px 0"/>${rows}`
      }
    },
    // 颜色映射最大值始终按当前视图重算（无数据时回退 1）
    visualMap: {
      min: 0, max: Math.max(1, m.maxVal), calculable: false, show: false,
      inRange: { color: ['#1e293b', '#fef08a', '#ef4444'] }
    },
    series: [{
      type: 'heatmap',
      data,
      label: { show: true, fontSize: 8 },
      emphasis: { itemStyle: { borderColor: '#e2e8f0', borderWidth: 1 } },
      animation: false
    }]
  }, { notMerge: true, replaceMerge: ['series'] })
}

const renderSignature = computed(() => [
  store.result, orient.value, split.value, store.sourceFilter,
  store.effectiveRange.start, store.effectiveRange.end,
  levels.value.join(','), scopedSources.value.join(',')
])
watch(renderSignature, () => nextTick(render))

function onResize() { inst?.resize() }
onMounted(() => {
  if (chart.value) inst = echarts.init(chart.value)
  nextTick(render)
  window.addEventListener('resize', onResize)
})
onUnmounted(() => { window.removeEventListener('resize', onResize); inst?.dispose() })
</script>

<style scoped>
.panel{background:#1e293b;border-radius:8px;padding:12px;border:1px solid #334155}
.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:8px;flex-wrap:wrap}
.panel h4{color:#38bdf8;font-size:13px}
.controls{display:flex;align-items:center;gap:10px}
.split-wrap{display:inline-flex;align-items:center;font-size:11px;color:#94a3b8}
.legend{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:10px;color:#94a3b8;margin-bottom:6px;padding:4px 6px;border:1px solid #334155;border-radius:4px;background:#0f172a66}
.lg-title{color:#64748b}
.chip{display:inline-flex;align-items:center;gap:3px}
.chip-dot{width:9px;height:9px;border-radius:2px;display:inline-block;border:1px solid #0f172a}
.lg-sep{width:1px;height:14px;background:#334155;margin:0 2px}
.scale{position:relative;display:inline-flex;align-items:center}
.scale-bar{width:90px;height:10px;border-radius:2px;border:1px solid #64748b;
  background:linear-gradient(to right,#1e293b,#fef08a,#ef4444);display:inline-block}
.s0{font-size:9px;margin-left:3px}
.smax{font-size:9px;margin-left:3px;color:#f87171;font-weight:700}
.lg-note{color:#64748b;font-size:9px}
.chart{width:100%;min-height:200px}
.notes{margin-top:4px;font-size:10px;color:#fbbf24}
.placeholder{height:200px;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:12px}
:deep(.el-radio-button__inner){padding:5px 9px;font-size:11px}
</style>
