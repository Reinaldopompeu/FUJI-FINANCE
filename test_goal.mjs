import assert from 'node:assert/strict';
import '../static/js/goal.js';
const {calculate, duration} = globalThis.CaixaGoal;
const state = { settings: {objetivo: {amount: 10000}}, banks: [{initial_balance: 1000}], transactions: [
  {date:'2026-09-16',type:'entrada',amount:3000},
  {date:'2026-10-15',type:'saida',amount:1000},
  {date:'2026-10-15',type:'transferencia',amount:500},
  {date:'2026-10-01',type:'entrada',amount:90000,status:'cancelado'},
  {date:'2026-12-01',type:'entrada',amount:90000}
]};
let result = calculate(state,'2026-10-15');
assert.equal(result.balance,3000);
assert.equal(result.remaining,7000);
assert.equal(result.activeMonths,2);
assert.equal(result.monthly,1000);
assert.equal(result.months,7);
assert.equal(result.status,'projected');
assert.equal(result.percent,30);
assert.equal(calculate({...state,settings:{}},'2026-10-15').percent,null);
assert.equal(calculate({...state,settings:{objetivo:{amount:2000}}},'2026-10-15').percent,100);
assert.equal(calculate({...state,banks:[],transactions:[{date:'2026-10-15',type:'saida',amount:100}]},'2026-10-15').percent,0);
assert.equal(calculate({settings:{objetivo:{amount:60000}},banks:[{initial_balance:1000}],transactions:[]},'2026-10-15').percent.toLocaleString('pt-BR',{maximumFractionDigits:2}),'1,67');
assert.equal(calculate({...state,settings:{}},'2026-10-15').status,'unset');
assert.equal(calculate({...state,transactions:[]},'2026-10-15').status,'empty');
assert.equal(calculate({...state,settings:{objetivo:{amount:3000}}},'2026-10-15').status,'reached');
assert.equal(calculate({...state,transactions:[{date:'2026-10-15',type:'saida',amount:100}]},'2026-10-15').status,'stalled');

// A January deposit keeps its monthly pace even when later months have no entries.
const january = {settings:{objetivo:{amount:60000}},banks:[],transactions:[
  {date:'2026-01-01',type:'entrada',amount:2000}
]};
result = calculate(january,'2026-10-15');
assert.equal(result.balance,2000);
assert.equal(result.remaining,58000);
assert.equal(result.activeMonths,1);
assert.equal(result.monthly,2000);
assert.equal(result.months,29);
assert.equal(duration(result.months),'2 anos e 5 meses');
assert.deepEqual(calculate(january,'2026-12-31'),result,'Empty months must not dilute the monthly average');

// Multiple entries in a month count once, skipped months do not count,
// and a month with expenses only still reduces the average.
result = calculate({...january,transactions:[
  {date:'2026-01-01',type:'entrada',amount:2000},
  {date:'2026-01-15',type:'entrada',amount:1000},
  {date:'2026-03-01',type:'entrada',amount:4000},
  {date:'2026-07-01',type:'saida',amount:1000},
  {date:'2026-08-01',type:'entrada',amount:99000,status:'cancelado'},
  {date:'2026-09-01',type:'transferencia',amount:99000},
  {date:'2026-12-01',type:'entrada',amount:99000},
  {date:'2026-02-30',type:'entrada',amount:99000}
]},'2026-10-15');
assert.equal(result.balance,6000);
assert.equal(result.activeMonths,3);
assert.equal(result.monthly,2000);
assert.equal(result.months,27);

result = calculate({...january,transactions:[
  {date:'2025-01-01',type:'entrada',amount:2000},
  {date:'2026-01-01',type:'entrada',amount:2000}
]},'2026-10-15');
assert.equal(result.activeMonths,2,'January in different years must count separately');
assert.equal(result.monthly,2000);
assert.equal(result.months,28);

// Count the current month once, without extrapolating a partial month.
result = calculate({...january,transactions:[{date:'2026-10-15',type:'entrada',amount:2000}]},'2026-10-15');
assert.equal(result.monthly,2000);
assert.equal(result.months,29);
assert.equal(calculate({...january,settings:{objetivo:{amount:61000}}},'2026-10-15').months,30,'Round partial forecast months up');
assert.equal(calculate({...january,settings:{objetivo:{amount:2100}}},'2026-10-15').months,1);
result = calculate({...january,transactions:[...january.transactions,{date:'2026-03-01',type:'saida',amount:2000}]},'2026-10-15');
assert.equal(result.status,'stalled');
assert.equal(result.months,null);
assert.equal(calculate({...january,transactions:[{date:'2026-12-01',type:'entrada',amount:2000}]},'2026-10-15').status,'empty');

result = calculate({settings:{objetivo:{amount:1.6}},transactions:[
  {date:'2026-01-01',type:'entrada',amount:0.1},
  {date:'2026-01-02',type:'entrada',amount:0.7}
]},'2026-10-15');
assert.equal(result.months,1,'Floating point sums must not add an extra forecast month');

assert.equal(duration(1),'1 mês');
assert.equal(duration(11),'11 meses');
assert.equal(duration(12),'1 ano');
assert.equal(duration(13),'1 ano e 1 mês');
assert.equal(duration(24),'2 anos');
assert.equal(duration(29),'2 anos e 5 meses');
console.log('OK: média mensal dos meses com lançamentos, saídas, meses vazios, anos distintos e previsão de 29 meses para janeiro.');
