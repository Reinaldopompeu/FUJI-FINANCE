import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../static/js/app.js', import.meta.url), 'utf8');
const field = (value) => ({ value, disabled: false, innerHTML: '', addEventListener() {} });
const visual = field('line'), category = field('all'), subcategory = field('all');
let filters, rendered, renderedVisual;
const analytics = { summary: { income: 10, expense: 5, margin: 50 }, monthly: { income: [10], expense: [5], balance: [5] }, categories: [{ value: 5 }], comparison: { current: [10], previous: [5] } };
const context = {
  document: { getElementById: (id) => id === 'chartStyle' ? visual : null, querySelector: (selector) => selector.includes('subcategory_id') ? subcategory : selector.includes('category_id') ? category : null },
  refreshDependentSubcategoryFilter() {}, escapeHtml: String, setText() {}, setPageBusy() {},
  formatCurrency: String, formatPercent: String, chartTextStyle: () => ({}), chartColor: () => '',
  getFilters: () => ({ category_id: category.value, subcategory_id: subcategory.value }),
  data: { getAnalytics: async (value) => { filters = value; return analytics; } },
  handleDataError: (error) => { throw error; },
  renderCashflowChart: (_series, _id, style) => { rendered = 'cashflow'; renderedVisual = style; },
  setChartOption: () => { rendered = 'empty'; },
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  function createChartsController()'), source.indexOf('  function createReportsController()')) + '\nvar controller = createChartsController();', context);
for (const style of ['line', 'pie', 'bar', 'histogram']) {
  visual.value = style;
  await context.controller.refresh();
  assert.equal(rendered, 'cashflow');
  assert.equal(renderedVisual, style);
}
category.value = 'out'; subcategory.value = 'old';
visual.value = 'line';
await context.controller.refresh();
assert.equal(filters.category_id, 'out'); assert.equal(filters.subcategory_id, 'old');
analytics.monthly.income = [0]; analytics.monthly.expense = [0];
await context.controller.refresh(); assert.equal(rendered, 'empty');
console.log('Chart controls: four visual styles, filters and empty state passed.');

// Exercise the actual chart option builder, including responsive axis overrides.
let chartOptions;
const renderContext = {
  document: { getElementById: () => ({}) },
  global: { echarts: { init: () => ({ setOption: (option) => { chartOptions = option; } }) }, matchMedia: () => ({ matches: false }) },
  charts: new Map(), chartTextStyle: () => ({}), chartColor: () => '#123456',
};
vm.createContext(renderContext);
vm.runInContext(source.slice(source.indexOf('  function setChartOption('), source.indexOf('  function chartTextStyle(')), renderContext);
const currencyLabel = (value) => `R$ ${value}`;
renderContext.setChartOption('analysisChart', {
  tooltip: { axisPointer: { type: 'shadow' } },
  xAxis: { type: 'value', axisLabel: { formatter: currencyLabel } },
  yAxis: { type: 'category', data: ['Janeiro'] },
  series: [{ type: 'bar', data: [10], barLayout: 'horizontal' }],
});
assert.equal(chartOptions.baseOption.tooltip.axisPointer.type, 'shadow');
assert.equal(chartOptions.media[0].option.yAxis.axisLabel.show, true);
assert.equal(chartOptions.media[0].option.yAxis.axisLabel.formatter('Janeiro'), 'Jan');
assert.equal(chartOptions.media[0].option.xAxis.axisLabel.formatter(10), 'R$ 10');
renderContext.setChartOption('balanceChart', { series: [{ type: 'line', data: [10] }] });
assert.equal(chartOptions.baseOption.series[0].showSymbol, true);
renderContext.setChartOption('balanceChart', { series: [{ type: 'line', data: [10, 20] }] });
assert.equal(chartOptions.baseOption.series[0].showSymbol, false);
console.log('Chart rendering: horizontal mobile labels, currency, pointer and single point passed.');
