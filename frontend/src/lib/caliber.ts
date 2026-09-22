import type { TimeWindow } from '@/types'

/** 级别归一化：各日志类型（apache notice / custom warning）统一到同一套口径 */
export function canonLevel(raw: string): string {
  const v = String(raw || '').toUpperCase()
  if (v === 'WARNING') return 'WARN'
  if (v === 'NOTICE') return 'INFO'
  return v
}

/** 全局统一的级别顺序（热力图、图例、提示均使用同一份口径） */
export const LEVEL_ORDER = ['ERROR', 'WARN', 'INFO', 'DEBUG']

/** 各级别在图例与文本中的配色（与色阶格子相区分：色阶=黄红连续色，级别=独立色块） */
export const LEVEL_COLORS: Record<string, string> = {
  ERROR: '#ef4444',
  WARN: '#f59e0b',
  INFO: '#38bdf8',
  DEBUG: '#a78bfa'
}

/** 按全局顺序排列级别，并补上数据中出现的其它级别 */
export function sortLevels(levels: Iterable<string>): string[] {
  const set = new Set(Array.from(levels, canonLevel))
  const known = LEVEL_ORDER.filter(l => set.has(l))
  const extra = Array.from(set).filter(l => !LEVEL_ORDER.includes(l)).sort()
  return [...known, ...extra]
}

/** 取窗口在指定来源口径下的各级别条数（归一化级别名） */
export function windowLevelMap(w: TimeWindow, sourceFilter: string | null): Record<string, number> {
  const out: Record<string, number> = {}
  const add = (m?: Record<string, number>) => {
    if (!m) return
    for (const [lv, c] of Object.entries(m)) out[canonLevel(lv)] = (out[canonLevel(lv)] || 0) + c
  }
  if (sourceFilter === null) {
    // 全部来源：新数据用 levels；老数据缺失时由 sourceLevels 兜底聚合
    add(w.levels)
    if (!Object.keys(w.levels).length && w.sourceLevels) {
      Object.values(w.sourceLevels).forEach(m => add(m))
    }
  } else if (w.sourceLevels) {
    // 指定来源：没有 sourceLevels 明细（老数据）时保持 0，不能用全量口径冒充
    add(w.sourceLevels[sourceFilter])
  }
  return out
}

/** 取窗口在指定来源口径下的总条数 */
export function windowScopedTotal(w: TimeWindow, sourceFilter: string | null): number {
  if (sourceFilter === null) return w.count
  return w.sources[sourceFilter] || 0
}

export function pct(part: number, total: number): string {
  if (!total) return '0.0%'
  return ((part / total) * 100).toFixed(1) + '%'
}
