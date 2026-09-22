<template>
  <div class="panel">
    <h4>📉 窗口日志量趋势</h4>
    <CaliberBar />
    <div v-if="!store.result" class="placeholder">生成日志后展示趋势</div>
    <div v-else>
      <div ref="chart" class="chart"></div>
      <div class="note">口径：{{ store.caliberText }}（仅统计当前来源条数，趋势按窗口区间裁剪）</div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as echarts from 'echarts'
import { useLogStore } from '../store/log'
import CaliberBar from './CaliberBar.vue'
const store = useLogStore(); const chart = ref<HTMLDivElement>(); let inst: echarts.ECharts|null=null
function update() {
  if (!inst||!store.result) return
  const cats = store.scopedWindowIndexes.map(i => 'W'+i)
  // 与热力图共用同一份口径：来源过滤后取窗口内当前来源条数
  const vals = store.scopedWindowIndexes.map(i => store.windowTotal(i))
  inst.setOption({
    backgroundColor:'transparent',grid:{left:40,right:15,top:10,bottom:25},
    xAxis:{type:'category',data:cats,axisLabel:{color:'#94a3b8',fontSize:9}},
    yAxis:{type:'value',axisLabel:{color:'#94a3b8'}},
    series:[{
      type:'bar',data:vals,itemStyle:{color:'#38bdf8'},
      markLine:{data:[{type:'average',name:'avg'}],lineStyle:{color:'#f97316',type:'dashed'},label:{color:'#f97316'}}
    }],animation:false
  }, true)
}
onMounted(()=>{if(chart.value){inst=echarts.init(chart.value);nextTick(update)}})
watch(()=>[store.result, store.caliberText],update)
onUnmounted(()=>inst?.dispose())
</script>
<style scoped>.panel{background:#1e293b;border-radius:8px;padding:12px;border:1px solid #334155}.panel h4{color:#38bdf8;font-size:13px;margin-bottom:4px}.chart{width:100%;height:200px}.note{font-size:10px;color:#64748b;margin-top:2px}.placeholder{height:200px;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:12px}</style>
