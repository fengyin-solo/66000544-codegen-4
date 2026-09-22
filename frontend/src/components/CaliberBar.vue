<template>
  <div class="caliber-bar">
    <span class="cal-label">口径：</span>
    <el-select :model-value="store.sourceFilter" size="small" class="src-select"
               @update:model-value="(v: string | null) => store.setSourceFilter(v ?? null)">
      <el-option :value="null" label="全部来源"/>
      <el-option v-for="s in store.allSources" :key="s" :value="s" :label="s"/>
    </el-select>
    <span class="range-box">
      窗口
      <input v-model="startText" class="range-input" inputmode="numeric"
             placeholder="0" @change="commitRange"/>
      <span class="dash">–</span>
      <input v-model="endText" class="range-input" inputmode="numeric"
             :placeholder="String(Math.max(0, store.windowCount - 1))" @change="commitRange"/>
      <el-button v-if="store.rangeApplied.start !== null || store.rangeApplied.end !== null"
                 link type="primary" size="small" @click="resetRange">重置</el-button>
    </span>
    <span class="cal-text">{{ store.caliberText }}</span>
    <span v-if="store.rangeError" class="range-err">⚠ {{ store.rangeError }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useLogStore } from '../store/log'
const store = useLogStore()
// 文本态：允许用户临时清空；提交（失焦）时再做校验
const startText = ref<string>('')
const endText = ref<string>('')

watch(() => [store.rangeStartInput, store.rangeEndInput], ([s, e]) => {
  startText.value = s === null ? '' : String(s)
  endText.value = e === null ? '' : String(e)
}, { immediate: true })

function commitRange() {
  const parse = (t: string) => t.trim() === '' ? null : Number(t)
  store.rangeStartInput = parse(startText.value)
  store.rangeEndInput = parse(endText.value)
  store.commitRange()
  // commitRange 在校验失败时会把取值恢复为上一次，同步回输入框
  startText.value = store.rangeStartInput === null ? '' : String(store.rangeStartInput)
  endText.value = store.rangeEndInput === null ? '' : String(store.rangeEndInput)
}

function resetRange() {
  store.rangeStartInput = null
  store.rangeEndInput = null
  store.rangeApplied = { start: null, end: null }
  store.rangeError = ''
  startText.value = ''
  endText.value = ''
}
</script>

<style scoped>
.caliber-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:#94a3b8;margin-bottom:8px}
.cal-label{color:#64748b}
.src-select{width:130px}
.range-box{display:flex;align-items:center;gap:4px}
.range-input{width:52px;height:24px;background:#0f172a;border:1px solid #334155;border-radius:4px;color:#e2e8f0;font-size:11px;padding:0 6px;font-family:inherit}
.range-input:focus{outline:none;border-color:#38bdf8}
.dash{color:#64748b}
.cal-text{color:#64748b;font-size:10px}
.range-err{color:#fbbf24;font-size:10px}
</style>
