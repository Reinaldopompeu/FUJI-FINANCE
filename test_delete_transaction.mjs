import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../static/js/app.js', import.meta.url), 'utf8');
const storage = new Map();
let failWrite = false, allowDelete = false, confirmation = '', errors = [], notices = [];
const element = () => ({ innerHTML: '', textContent: '', handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } });
const tbody = element(), count = element(), pagination = element();
const document = { body: { dataset: { demo: 'true' } }, querySelector: () => null,
  getElementById: id => ({transactionsTableBody: tbody, transactionsCount: count, transactionsPagination: pagination})[id] };
const window = { document, localStorage: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => { if (failWrite) throw Error('Storage unavailable'); storage.set(key, String(value)); }
}, confirm: text => { confirmation = text; return allowDelete; } };
const context = vm.createContext({ window, global: window, document, console, Date, Intl, URL, Blob,
  fetch: () => { throw Error('Unexpected network request'); },
  getFilters: () => ({period: 'all'}), setPageBusy() {}, refreshIcons() {}, refreshCatalogCache: async () => {},
  renderPagination: (_container, page, pages) => { pagination.page = page; pagination.pages = pages; },
  emptyTableRow: columns => `<tr><td colspan="${columns}">Empty</td></tr>`,
  showToast: text => notices.push(text), handleDataError: error => errors.push(error.message),
  formatDate: String, formatCurrency: value => `R$ ${Number(value).toFixed(2)}`
});
vm.runInContext(fs.readFileSync(new URL('../static/js/data-service.js', import.meta.url), 'utf8'), context);
context.data = window.AndesData;
vm.runInContext(source.slice(source.indexOf('  function escapeHtml('), source.indexOf('\n})(window);')), context);
vm.runInContext(source.slice(source.indexOf('  function transactionRow('), source.indexOf('  function notificationItem(')), context);
vm.runInContext(source.slice(source.indexOf('  function createTransactionsController()'), source.indexOf('  function createChartsController()')) + '\nvar controller = createTransactionsController();', context);
const data = context.data;
const income = await data.createCategory({name: 'Salário', flow: 'entrada'});
const expense = await data.createCategory({name: 'Alimentação', flow: 'saida'});
const deposit = await data.createTransaction({flow:'entrada', origin_type:'categoria', origin_id:income.id, amount:1000, date:'2026-10-01', description:'Entrada teste'});
const withdrawal = await data.createTransaction({flow:'saida', destination_type:'categoria', destination_id:expense.id, amount:250, date:'2026-10-02', description:'Saída <teste> "especial"'});
await context.controller.refresh();
assert.match(tbody.innerHTML, /data-delete-transaction=/);
assert.match(tbody.innerHTML, /Saída &lt;teste&gt; &quot;especial&quot;/);
const clickDelete = async id => {
  const button = {disabled:false, dataset:{deleteTransaction:String(id)}};
  await tbody.handlers.click({target:{closest:()=>button}});
  assert.equal(button.disabled, false);
};
await clickDelete(withdrawal.id);
assert.equal((await data.listTransactions()).count, 2, 'Cancel must keep the transaction');
assert.equal((await data.listBanks())[0].current_balance, 750);
assert.match(confirmation, /Saída <teste>/);
assert.match(confirmation, /250.00/);
assert.match(confirmation, /2026-10-02/);
allowDelete = true;
await clickDelete(withdrawal.id);
assert.equal((await data.listTransactions()).count, 1);
assert.equal((await data.listBanks())[0].current_balance, 1000);
assert.equal((await data.getAnalytics({period:'all'})).summary.expense, 0);
assert.match(count.textContent, /1 de 1/);
assert(!tbody.innerHTML.includes(`data-delete-transaction="${withdrawal.id}"`));
assert.equal(notices.length, 1);
failWrite = true;
await clickDelete(deposit.id);
failWrite = false;
assert.equal((await data.listTransactions()).count, 1, 'Failed save must keep stored data');
assert.equal(errors.length, 1);
assert.equal(notices.length, 1, 'Failure must not announce success');
for (let i=0; i<10; i++) await data.createTransaction({flow:'saida', destination_type:'categoria', destination_id:expense.id, amount:10, date:'2026-10-03', description:`Teste ${i}`});
pagination.handlers.click({target:{closest:()=>({dataset:{page:'2'},disabled:false})}});
await context.controller.refresh();
assert.equal(pagination.page, 2);
await clickDelete(deposit.id);
assert.equal(pagination.page, 1, 'Removing the last row of page two must return to page one');
assert.equal(pagination.pages, 1);
assert.equal((await data.listBanks())[0].current_balance, -100);
assert.equal((await data.listTransactions()).data[0].balance_after, -100);
console.log('OK: botão Excluir, confirmação/cancelamento, saldos, falhas de gravação e paginação.');
