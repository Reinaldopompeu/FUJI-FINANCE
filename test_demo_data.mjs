import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const saved = new Map();
const localStorage = {getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,String(value)),removeItem:key=>saved.delete(key)};
const document = {body:{dataset:{demo:'true'}},querySelector:()=>null};
const window = {localStorage,sessionStorage:localStorage,document};
window.window=window;
const context=vm.createContext({window,document,Date,Intl,console,URL,Blob,fetch:()=>{throw Error('Unexpected network request');}});
const source=fs.readFileSync(new URL('../static/js/data-service.js',import.meta.url),'utf8');
vm.runInContext(fs.readFileSync(new URL('../static/js/goal.js',import.meta.url),'utf8'),context);
vm.runInContext(source,context);
let data=window.AndesData;
assert.equal((await data.listBanks()).length,1);
assert.equal((await data.listBanks())[0].name,'Banco Geral');
assert.equal((await data.listBanks())[0].current_balance,0);
const income=await data.createCategory({name:'Salário',flow:'entrada'});
const expense=await data.createCategory({name:'Viagem',flow:'saida'});
const sub={id:1,category_id:expense.id,name:'Passagem',active:true};
const legacy=JSON.parse(localStorage.getItem('caixa-facil.demo.session.v1'));
legacy.subcategories=[sub];
localStorage.setItem('caixa-facil.demo.session.v1',JSON.stringify(legacy));
assert.equal(data.createSubcategory,undefined);
assert.equal(data.listSubcategories,undefined);
const deposit=await data.createTransaction({flow:'entrada',origin_type:'categoria',origin_id:income.id,amount:1000,date:'2026-10-01',description:'Entrada de teste'});
assert.equal(deposit.destination.id,'banco-geral');
const withdrawal=await data.createTransaction({flow:'saida',destination_type:'categoria',destination_id:expense.id,subcategory_id:sub.id,amount:250,date:'2026-10-02',description:'Passagem de teste'});
assert.equal(withdrawal.origin.id,'banco-geral');
assert.equal((await data.listBanks())[0].current_balance,750);
await data.updateTransaction(withdrawal.id,{flow:'saida',destination_type:'categoria',destination_id:expense.id,subcategory_id:sub.id,origin_id:'outro-banco',amount:200,date:'2026-10-02',description:'Passagem revisada'});
assert.equal((await data.listBanks())[0].current_balance,800);
assert.equal((await data.getAnalytics({period:'all'})).summary.balance,800);
await assert.rejects(()=>data.createTransaction({flow:'transferencia'}),/Banco Geral/);
const withoutSub=await data.createTransaction({flow:'saida',destination_type:'categoria',destination_id:expense.id,amount:10,description:'Sem subcategoria'});
assert.equal(withoutSub.subcategory_id,undefined);
assert.equal((await data.listBanks())[0].current_balance,790);
await data.deleteTransaction(withoutSub.id);
assert.equal((await data.getTransaction(withdrawal.id)).subcategory_id,undefined);
assert.equal((await data.listTransactions({subcategory_id:999})).count,2);
await assert.rejects(()=>data.saveSettings('objetivo',{amount:-1}),/objetivo/);
await data.saveSettings('objetivo',{amount:50000});

vm.runInContext(source,context);
data=window.AndesData;
assert.equal((await data.getSettings('objetivo')).amount,50000);
assert.equal((await data.listTransactions()).count,2);
await data.deleteTransaction(withdrawal.id);
assert.equal((await data.listBanks())[0].current_balance,1000);
// Migration of populated data: preserve net balance, history and settings.
const old=JSON.parse(localStorage.getItem('caixa-facil.demo.session.v1'));
delete old.generalBankVersion;
old.banks=[{id:'a',name:'A',initial_balance:1000,active:true},{id:'b',name:'B',initial_balance:500,active:true}];
old.transactions=[
 {id:1,type:'entrada',date:'2026-10-01',amount:200,destination:{type:'banco',id:'a',name:'A'},origin:{type:'categoria',id:income.id,name:income.name}},
 {id:2,type:'saida',date:'2026-10-02',amount:50,origin:{type:'banco',id:'b',name:'B'},destination:{type:'categoria',id:expense.id,name:expense.name}},
 {id:3,type:'transferencia',date:'2026-10-03',amount:300,origin:{type:'banco',id:'a',name:'A'},destination:{type:'banco',id:'b',name:'B'}},
 {id:4,type:'entrada',date:'2026-10-03',amount:9000,status:'cancelado',destination:{type:'banco',id:'a',name:'A'}}
];
old.reports=[{id:1,type:'banco',filters:{bank_id:'a'}}];
const oldRaw=JSON.stringify(old);
localStorage.setItem('caixa-facil.demo.session.v1',oldRaw);
const bank=(await data.listBanks())[0];
assert.equal(bank.initial_balance,1500);
assert.equal(bank.current_balance,1650);
assert.equal((await data.getGoalProgress()).balance,1650);
assert.equal((await data.listTransactions()).count,4);
assert.equal((await data.listReports()).data[0].filters.bank_id,'banco-geral');
assert.equal(localStorage.getItem('caixa-facil.demo.session.v1.before-general-bank'),oldRaw);
assert.equal((await data.listBanks())[0].current_balance,1650,'Migration must be idempotent');
assert.equal((await data.getSettings('objetivo')).amount,50000);
console.log('OK: Banco Geral automático, entradas, saídas, edição, persistência e migração sem alteração do saldo.');

// All-history analytics must keep years distinct and carry balances across gaps.
const multiYear=JSON.parse(localStorage.getItem('caixa-facil.demo.session.v1'));
multiYear.banks[0].initial_balance=100;
multiYear.transactions=[
 {id:1,date:'2024-01-10',type:'entrada',amount:1000,status:'liquidado'},
 {id:2,date:'2025-02-10',type:'saida',amount:200,status:'liquidado'},
 {id:3,date:'2026-01-10',type:'entrada',amount:300,status:'liquidado'},
 {id:4,date:'2027-01-10',type:'entrada',amount:999,status:'cancelado'}
];
localStorage.setItem('caixa-facil.demo.session.v1',JSON.stringify(multiYear));
const history=await data.getAnalytics({period:'all'});
assert.equal(history.monthly.labels.length,36);
assert.equal(history.monthly.labels[0],'Jan/2024');
assert.equal(history.monthly.labels[24],'Jan/2026');
assert.equal(history.monthly.income[0],1000);
assert.equal(history.monthly.income[24],300);
assert.equal(history.monthly.expense[13],200);
assert.equal(history.monthly.balance[12],1100);
assert.equal(history.monthly.balance[13],900);
assert.equal(history.summary.balance,1200);
assert.equal(history.monthly.balance.at(-1),history.summary.balance);
assert.equal((await data.getAnalytics()).summary.balance,1200);
const singleYear=await data.getAnalytics({period:'2025'});
assert.equal(singleYear.monthly.labels.length,12);
assert.equal(singleYear.summary.openingBalance,1100);
assert.equal(singleYear.summary.balance,900);
console.log('OK: todos os anos, meses vazios, cancelamentos e saldo entre anos.');

const beforeInitial=await data.listTransactions();
await data.saveSettings('saldo-inicial',{amount:500});
assert.equal((await data.getSettings('saldo-inicial')).amount,500);
assert.equal((await data.getAnalytics({period:'all'})).summary.balance,1600);
await data.saveSettings('saldo-inicial',{amount:500});
assert.equal((await data.getAnalytics({period:'all'})).summary.balance,1600);
assert.equal((await data.listTransactions()).count,beforeInitial.count);
await assert.rejects(()=>data.saveSettings('saldo-inicial',{amount:-1}),/saldo inicial/);
await data.saveSettings('saldo-inicial',{amount:0});
assert.equal((await data.getSettings('saldo-inicial')).amount,0);
console.log('OK: saldo inicial substituído, persistido, validado e sem criar lançamentos.');
