// Opcional: VENDOR_ROOT aponta para node_modules de um ambiente temporário.
const assert = require('node:assert/strict');
const path = require('node:path');
if (!process.env.VENDOR_ROOT) throw new Error('Defina VENDOR_ROOT para testar as bibliotecas de publicação.');
const echarts = require(path.join(process.env.VENDOR_ROOT, 'echarts'));
const { jsPDF } = require(path.join(process.env.VENDOR_ROOT, 'jspdf'));
const lucide = require(path.join(process.env.VENDOR_ROOT, 'lucide'));
for (const type of ['line', 'bar', 'pie']) {
  const chart = echarts.init(null, null, {renderer:'svg', ssr:true, width:800, height:400});
  chart.setOption(type === 'pie' ? {series:[{type, data:[{name:'Categoria',value:25}]}]} : {xAxis:{type:'category',data:['Jan','Fev']},yAxis:{type:'value'},series:[{type,data:[10,20]}]});
  assert(chart.renderToSVGString().includes('<svg'));
  chart.dispose();
}
const pdf = new jsPDF(); pdf.text('Relatorio de teste', 10, 10);
assert(pdf.output().startsWith('%PDF'));
assert.equal(typeof lucide.createIcons, 'function');
for (const icon of ['Landmark','CircleCheck','ChartLine','GraduationCap']) assert(icon in lucide.icons);
console.log('OK: ECharts linhas/colunas/setores SSR, jsPDF e ícones nas versões fixadas.');
