/* Camada única de dados. Em modo autenticado usa Flask/SQLAlchemy; em demonstração
   usa exclusivamente sessionStorage e nunca chama APIs financeiras do backend. */
(function createCaixaData(global) {
  "use strict";

  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
  const demoMode = document.body?.dataset.demo === "true";
  const demoKey = "caixa-facil.demo.session.v1";
  const locale = "pt-BR";
  const currencyCode = "BRL";

  const tutorialKey = "caixa-facil.tutorial.sandbox.v1";
  function tutorialActive() { return global.sessionStorage?.getItem(tutorialKey) != null; }
  function useLocalData() { return demoMode || tutorialActive(); }
  function beginTutorial() {
    if (!global.sessionStorage) throw new Error("Não foi possível iniciar a demonstração temporária.");
    global.sessionStorage.setItem(tutorialKey, JSON.stringify(demoSeed()));
  }
  function endTutorial() { global.sessionStorage?.removeItem(tutorialKey); }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function isoToday() { return new Date().toLocaleDateString("sv-SE"); }
  function monthOf(date) { return String(date || "").slice(0, 7); }
  function yearOf(date) { return String(date || "").slice(0, 4); }
  function slug(value) {
    return String(value || "item").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
  }

  function demoSeed() {
    return {
      schemaVersion: 2,
      categories: [], banks: [], transactions: [],
      settings: { empresa: { company: "" }, financeiro: { defaultPeriod: "year", currency: "BRL", confirmDelete: true }, aparencia: { density: "comfortable", reducedMotion: false }, notificacoes: {} },
      reports: [], notifications: [],
      next: { transaction: 1, report: 1, notification: 1 },
    };
  }

  function demoTransaction(id, date, type, amount, description, origin, destination, category) {
    return {
      id, date, data_iso: date, type, flow: type, amount, description, descricao: description, valor: amount,
      origem: origin.name, destino: destination.name,
      origin: { type: origin.type, name: origin.name, id: origin.id }, destination: { type: destination.type, name: destination.name, id: destination.id },
      origin_bank: origin.type === "banco" ? origin.name : null, destination_bank: destination.type === "banco" ? destination.name : null,
      bank: type === "entrada" ? destination.name : origin.name,
      category_id: category?.id || null, category: category ? clone(category) : null,



      status: "liquidado", document_number: `DEMO-${String(id).padStart(4, "0")}`,
    };
  }

  function migrateGeneralBank(state, raw) {
    if (state.generalBankVersion === 1) return state;
    // Keep the previous browser state before the one-time consolidation.
    if (!tutorialActive() && raw && !global.sessionStorage.getItem(demoKey + ".before-general-bank")) {
      global.sessionStorage.setItem(demoKey + ".before-general-bank", raw);
    }
    const bank = { id: "banco-geral", name: "Banco Geral", type: "banco", active: true,
      color: "#2563eb", bank_category: "Disponível",
      initial_balance: Math.round((state.banks || []).filter((item) => item.active !== false)
        .reduce((sum, item) => sum + Number(item.initial_balance || 0), 0) * 100) / 100 };
    state.transactions.forEach((tx) => {
      if (["saida", "transferencia"].includes(tx.type)) {
        tx.origin = {type:"banco", id:bank.id, name:bank.name};
        tx.origem = bank.name; tx.origin_bank = bank.name;
      }
      if (["entrada", "transferencia"].includes(tx.type)) {
        tx.destination = {type:"banco", id:bank.id, name:bank.name};
        tx.destino = bank.name; tx.destination_bank = bank.name;
      }
      tx.bank = bank.name;
    });
    (state.reports || []).forEach((report) => {
      if (report.type === "banco" || report.filters?.bank_id) {
        report.filters = {...report.filters, bank_id: bank.id};
      }
    });
    state.banks = [bank];
    state.generalBankVersion = 1;
    writeDemo(state);
    return state;
  }
  function readDemo() {
    const raw = tutorialActive() ? global.sessionStorage.getItem(tutorialKey) : global.sessionStorage.getItem(demoKey);
    let state;
    if (raw) {
      try { state = JSON.parse(raw); }
      catch (_) { throw new Error("Não foi possível ler os dados salvos. Seus registros foram preservados."); }
    }
    return migrateGeneralBank(state || demoSeed(), raw);
  }
  function writeDemo(state) { if (tutorialActive()) global.sessionStorage.setItem(tutorialKey, JSON.stringify(state)); else global.sessionStorage.setItem(demoKey, JSON.stringify(state)); }
  function mutateDemo(fn) { const state = readDemo(); const result = fn(state); writeDemo(state); return clone(result); }

  async function request(path, options = {}) {
    if (useLocalData()) throw new Error("Operação bloqueada: a demonstração não acessa a API de persistência.");
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.method && !["GET", "HEAD"].includes(options.method.toUpperCase())) headers["X-CSRF-Token"] = csrfToken;
    const response = await fetch(path, { ...options, headers });
    if (response.status === 401) { global.location.href = "/login"; throw new Error("Sua sessão expirou."); }
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) throw new Error(payload?.erro || payload?.message || `Erro ${response.status}`);
    return payload;
  }

  function queryString(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      params.set(key === "pageSize" ? "page_size" : key, String(value));
    });
    return params.toString() ? `?${params}` : "";
  }

  function demoBankBalance(state, bank) {
    let balance = Number(bank.initial_balance || 0);
    state.transactions.filter((tx) => tx.status !== "cancelado").forEach((tx) => {
      const amount = Number(tx.amount || 0);
      if (tx.type === "entrada" && tx.destination?.id === bank.id) balance += amount;
      else if (tx.type === "saida" && tx.origin?.id === bank.id) balance -= amount;
      else if (tx.type === "transferencia") {
        if (tx.origin?.id === bank.id) balance -= amount;
        if (tx.destination?.id === bank.id) balance += amount;
      }
    });
    return balance;
  }
  function demoInitialTotal(state) { return state.banks.filter((bank) => bank.active !== false).reduce((sum, bank) => sum + Number(bank.initial_balance || 0), 0); }
  function demoBalanceImpact(tx, bankId = null) {
    if (tx.status === "cancelado") return 0;
    const amount = Number(tx.amount || 0);
    if (!bankId) {
      if (tx.type === "entrada") return amount;
      if (tx.type === "saida") return -amount;
      return 0;
    }
    if (tx.type === "entrada" && tx.destination?.id === bankId) return amount;
    if (tx.type === "saida" && tx.origin?.id === bankId) return -amount;
    if (tx.type === "transferencia") {
      let impact = 0;
      if (tx.origin?.id === bankId) impact -= amount;
      if (tx.destination?.id === bankId) impact += amount;
      return impact;
    }
    return 0;
  }
  function demoInitialForFilters(state, filters = {}) {
    const bankId = filters.bank_id && filters.bank_id !== "all" ? filters.bank_id : null;
    if (!bankId) return demoInitialTotal(state);
    return Number(state.banks.find((bank) => bank.id === bankId && bank.active !== false)?.initial_balance || 0);
  }

  function withUsage(items, state, kind) {
    return items.map((item) => {
      let usage = 0;
      if (kind === "categoria") usage = state.transactions.filter((tx) => tx.category_id === item.id).length;
      if (kind === "banco") usage = state.transactions.filter((tx) => tx.origin?.id === item.id || tx.destination?.id === item.id).length;
      const extra = kind === "banco" ? { initial_balance: Number(item.initial_balance || 0), current_balance: demoBankBalance(state, item) } : {};
      return { ...clone(item), ...extra, usage_count: usage };
    });
  }

  async function listCategories() {
    if (useLocalData()) { const s = readDemo(); return withUsage(s.categories.filter((x) => x.active), s, "categoria"); }
    return (await request("/api/categorias")).categorias || [];
  }
  async function createCategory(payload) {
    if (!useLocalData()) return (await request("/api/categorias", { method: "POST", body: JSON.stringify(payload) })).categoria;
    return mutateDemo((s) => {
      const name = String(payload.name || payload.nome || "").trim();
      if (name.length < 2) throw new Error("Informe um nome de categoria válido.");
      if (s.categories.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error("Já existe uma categoria com esse nome.");
      let id = slug(name), n = 2; while (s.categories.some((x) => x.id === id)) id = `${slug(name).slice(0, 35)}-${n++}`;
      if (!["entrada","saida"].includes(payload.flow)) throw new Error("Selecione o fluxo da categoria.");
      const item = { id, name, flow: payload.flow, color: payload.color || "#64748b", active: true, type: "categoria" };
      s.categories.push(item);
      return item;
    });
  }
  async function updateCategory(id, payload) {
    if (!useLocalData()) return (await request(`/api/categorias/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) })).categoria;
    return mutateDemo((s) => { const item = s.categories.find((x) => x.id === id); if (!item) throw new Error("Categoria não encontrada."); const flow = payload.flow || item.flow; if (!["entrada","saida"].includes(flow)) throw new Error("Selecione um fluxo válido."); if (flow !== item.flow && s.transactions.some((tx)=>tx.category_id === id)) throw new Error("Categoria com lançamentos não pode mudar de fluxo."); item.flow = flow; item.name = String(payload.name || item.name).trim(); item.color = payload.color || item.color;  return item; });
  }
  async function deleteCategory(id) {
    if (!useLocalData()) return request(`/api/categorias/${encodeURIComponent(id)}`, { method: "DELETE" });
    return mutateDemo((s) => { if (s.transactions.some((x) => x.category_id === id)) throw new Error("A categoria possui lançamentos e não pode ser excluída."); s.categories = s.categories.filter((x) => x.id !== id); return { mensagem: "Categoria excluída." }; });
  }

  async function listBanks() {
    if (useLocalData()) { const s = readDemo(); return withUsage(s.banks.filter((x) => x.active), s, "banco"); }
    return (await request("/api/bancos")).bancos || [];
  }
  async function createBank(payload) {
    if (!useLocalData()) return (await request("/api/bancos", { method: "POST", body: JSON.stringify(payload) })).banco;
    return mutateDemo((s) => { const name = String(payload.name || "").trim(); const initialBalance = Number(payload.initial_balance ?? payload.saldo_inicial ?? 0); if (name.length < 2) throw new Error("Informe um nome de banco válido."); if (!Number.isFinite(initialBalance) || Math.abs(initialBalance) > 999999999999.99) throw new Error("Informe um saldo inicial válido."); if (s.banks.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error("Já existe um banco com esse nome."); let id = slug(name), n = 2; while (s.banks.some((x) => x.id === id)) id = `${slug(name).slice(0,35)}-${n++}`; const bankCategory = "Disponível"; if (bankCategory.length < 2 || bankCategory.length > 80) throw new Error("Informe uma categoria bancária de 2 a 80 caracteres."); const item = { id, name, bank_category: bankCategory, color: payload.color || "#2563eb", initial_balance: initialBalance, active: true, type: "banco" }; s.banks.push(item); return item; });
  }
  async function updateBank(id, payload) {
    if (!useLocalData()) return (await request(`/api/bancos/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) })).banco;
    return mutateDemo((s) => { const item = s.banks.find((x) => x.id === id); if (!item) throw new Error("Banco não encontrado."); const old = item.name; const initialBalance = payload.initial_balance === undefined ? Number(item.initial_balance || 0) : Number(payload.initial_balance); if (!Number.isFinite(initialBalance) || Math.abs(initialBalance) > 999999999999.99) throw new Error("Informe um saldo inicial válido."); item.name = String(payload.name || item.name).trim(); item.color = payload.color || item.color; item.initial_balance = initialBalance; s.transactions.forEach((tx) => { if (tx.origin?.id === id) { tx.origin.name = item.name; tx.origem = item.name; if (tx.origin_bank) tx.origin_bank = item.name; } if (tx.destination?.id === id) { tx.destination.name = item.name; tx.destino = item.name; if (tx.destination_bank) tx.destination_bank = item.name; } if (tx.bank === old) tx.bank = item.name; }); return item; });
  }
  async function deleteBank(id) {
    if (!useLocalData()) return request(`/api/bancos/${encodeURIComponent(id)}`, { method: "DELETE" });
    return mutateDemo((s) => { if (s.transactions.some((x) => x.origin?.id === id || x.destination?.id === id)) throw new Error("O banco possui lançamentos e não pode ser excluído."); s.banks = s.banks.filter((x) => x.id !== id); return { mensagem: "Banco excluído." }; });
  }

  function localFilteredTransactions(filters = {}) {
    const s = readDemo(); let rows = clone(s.transactions);
    if (filters.period && filters.period !== "all") rows = rows.filter((x) => filters.period.length === 4 ? yearOf(x.date) === filters.period : monthOf(x.date) === filters.period);
    if (filters.category_id && filters.category_id !== "all") rows = rows.filter((x) => x.category_id === filters.category_id);
    if (filters.bank_id && filters.bank_id !== "all") rows = rows.filter((x) => x.origin?.id === filters.bank_id || x.destination?.id === filters.bank_id);
    if (filters.flow && filters.flow !== "all") rows = rows.filter((x) => x.type === filters.flow);
    if (filters.search) { const q = String(filters.search).toLowerCase(); rows = rows.filter((x) => [x.description, x.origem, x.destino, x.category?.name, x.document_number].some((v) => String(v || "").toLowerCase().includes(q))); }
    return rows;
  }

  async function listPeriods() {
    if (!useLocalData()) return request("/api/periodos");
    const rows = readDemo().transactions; const months = [...new Set(rows.map((x) => monthOf(x.date)))].sort().reverse(); const years = [...new Set(rows.map((x) => yearOf(x.date)))].sort().reverse(); const now = new Date(); const current = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`; if (!months.includes(current)) months.unshift(current); if (!years.includes(String(now.getFullYear()))) years.unshift(String(now.getFullYear())); return { meses: months, anos: years, atual: current, ano_atual: String(now.getFullYear()) };
  }
  async function listTransactions(filters = {}) {
    if (!useLocalData()) { const result = await request(`/api/lancamentos${queryString(filters)}`); return { data: result.data || result.lancamentos || [], count: Number(result.count ?? 0) }; }
    const all = localFilteredTransactions(filters).sort((a,b) => b.date.localeCompare(a.date) || b.id-a.id);
    const state = readDemo(); const chronological = clone(state.transactions).sort((a,b) => a.date.localeCompare(b.date) || a.id-b.id); let balance = demoInitialTotal(state); const balances = new Map(); chronological.forEach((x) => { if (x.status !== "cancelado") { if (x.type === "entrada") balance += Number(x.amount); if (x.type === "saida") balance -= Number(x.amount); } balances.set(x.id, balance); });
    const page = Math.max(1, Number(filters.page || 1)), size = Math.max(1, Math.min(1000, Number(filters.pageSize || filters.page_size || 1000))); const start = (page-1)*size; return { data: all.slice(start,start+size).map((x) => ({...x, balance_after: balances.get(x.id) || 0})), count: all.length };
  }
  async function getTransaction(id) { if (!useLocalData()) return (await request(`/api/lancamentos/${encodeURIComponent(id)}`)).lancamento; return clone(readDemo().transactions.find((x) => x.id === Number(id))); }

  function resolveDemoItem(state, type, id) {
    if (type === "categoria") return state.categories.find((x) => x.active !== false && x.id === id);
    if (type === "banco") return state.banks.find((x) => x.active !== false && x.id === id);
    return null;
  }

  function validateDemoTransaction(state, payload) {
    const flow = String(payload.flow || payload.type || "").toLowerCase();
    if (!["entrada", "saida", "transferencia"].includes(flow)) throw new Error("Selecione um fluxo válido.");
    if (flow === "transferencia") throw new Error("Com o Banco Geral, registre apenas entradas ou saídas.");
    payload = flow === "entrada"
      ? {...payload, destination_type: "banco", destination_id: "banco-geral"}
      : {...payload, origin_type: "banco", origin_id: "banco-geral"};
    const expected = { entrada: ["categoria", "banco"], saida: ["banco", "categoria"], transferencia: ["banco", "banco"] }[flow];
    if (payload.origin_type !== expected[0] || payload.destination_type !== expected[1]) throw new Error("Origem e destino não correspondem ao fluxo selecionado.");
    const amount = Number(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999.99) throw new Error("Informe um valor válido.");
    const description = String(payload.description || "").trim();
    if (description.length < 2 || description.length > 80) throw new Error("A descrição deve ter entre 2 e 80 caracteres.");
    const dateValue = String(payload.date || isoToday());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || Number.isNaN(Date.parse(`${dateValue}T00:00:00Z`))) throw new Error("Informe uma data válida.");
    const origin = resolveDemoItem(state, payload.origin_type, payload.origin_id);
    const destination = resolveDemoItem(state, payload.destination_type, payload.destination_id);
    if (!origin || !destination) throw new Error("Selecione origem e destino válidos.");
    if (flow === "transferencia" && origin.id === destination.id) throw new Error("O destino deve ser diferente da origem.");
    const category = flow === "entrada" ? origin : flow === "saida" ? destination : null;
    if (flow !== "transferencia" && (!category || category.flow !== flow)) throw new Error("A categoria não pertence ao fluxo selecionado.");
    return { flow, amount, description, dateValue, origin, destination, category };
  }

  async function createTransaction(payload) {
    if (!useLocalData()) return (await request("/api/lancamentos", { method: "POST", body: JSON.stringify(payload) })).lancamento;
    return mutateDemo((state) => {
      const valid = validateDemoTransaction(state, payload);
      const id = state.next.transaction++;
      const transaction = demoTransaction(id, valid.dateValue, valid.flow, valid.amount, valid.description, valid.origin, valid.destination, valid.category);
      state.transactions.push(transaction);
      return transaction;
    });
  }

  async function updateTransaction(id, payload) {
    if (!useLocalData()) return (await request(`/api/lancamentos/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(payload) })).lancamento;
    return mutateDemo((state) => {
      const index = state.transactions.findIndex((x) => x.id === Number(id));
      if (index < 0) throw new Error("Lançamento não encontrado.");
      const valid = validateDemoTransaction(state, payload);
      const transaction = demoTransaction(Number(id), valid.dateValue, valid.flow, valid.amount, valid.description, valid.origin, valid.destination, valid.category);
      transaction.document_number = state.transactions[index].document_number || transaction.document_number;
      state.transactions[index] = transaction;
      return transaction;
    });
  }
  async function deleteTransaction(id) { if (!useLocalData()) return request(`/api/lancamentos/${encodeURIComponent(id)}`, { method:"DELETE" }); return mutateDemo((s) => { s.transactions=s.transactions.filter((x)=>x.id!==Number(id)); return {mensagem:"Lançamento removido."}; }); }

  async function getAnalytics(filters = {}) {
    if (!useLocalData()) return request(`/api/analytics${queryString(filters)}`);
    const state = readDemo();
    const rows = localFilteredTransactions(filters).filter((x) => x.status !== "cancelado");
    const period = filters.period || "all";
    const year = Number(String(period).slice(0,4)) || new Date().getFullYear();
    const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    const years = rows.map((row) => Number(yearOf(row.date))).filter(Number.isFinite);
    const firstYear = period === "all" && years.length ? years.reduce((a,b) => Math.min(a,b)) : year;
    const lastYear = period === "all" && years.length ? years.reduce((a,b) => Math.max(a,b)) : year;
    const monthly = Array.from({length:(lastYear-firstYear+1)*12},()=>({income:0,expense:0,movement:0,balance:0}));
    const labels = monthly.map((_,i) => period === "all" ? `${monthNames[i%12]}/${firstYear+Math.floor(i/12)}` : monthNames[i%12]);
    let income=0, expense=0; const catMap=new Map();
    const bankId = filters.bank_id && filters.bank_id !== "all" ? filters.bank_id : null;
    rows.forEach((x)=>{
      if(x.type==="entrada") income+=Number(x.amount);
      if(x.type==="saida"){ expense+=Number(x.amount); const key=x.category_id||"sem"; const current=catMap.get(key)||{id:key,name:x.category?.name||"Sem categoria",color:x.category?.color||"#a3a8b1",value:0}; current.value+=Number(x.amount); catMap.set(key,current); }
      const m=(Number(yearOf(x.date))-firstYear)*12+Number(x.date.slice(5,7))-1; if(m>=0 && m<monthly.length){ if(x.type==="entrada")monthly[m].income+=Number(x.amount); if(x.type==="saida")monthly[m].expense+=Number(x.amount); monthly[m].movement+=demoBalanceImpact(x,bankId); }
    });
    const analyticFilter=[filters.category_id,filters.flow,filters.search].some((value)=>value&&value!=="all");
    const withoutPeriod={...filters}; delete withoutPeriod.period;
    const periodStart = period === "all" ? null : (String(period).length===4 ? `${period}-01-01` : `${period}-01`);
    const previousRows=periodStart ? localFilteredTransactions(withoutPeriod).filter((x)=>x.status!=="cancelado" && x.date<periodStart) : [];
    let opening=analyticFilter?0:demoInitialForFilters(state,filters);
    if(!analyticFilter) previousRows.forEach((x)=>{opening+=demoBalanceImpact(x,bankId);});
    let balance=opening; monthly.forEach((m)=>{balance+=m.movement;m.balance=balance;});
    const active=monthly.map((m,i)=>[i,m]).filter(([,m])=>m.income||m.expense||m.movement); const best=active.length?active.reduce((a,b)=>(b[1].income-b[1].expense)>(a[1].income-a[1].expense)?b:a):[0,monthly[0]];
const all = localFilteredTransactions(withoutPeriod); const byYear=(y)=>Array.from({length:12},(_,i)=>all.filter((x)=>x.type==="entrada"&&x.status!=="cancelado"&&Number(yearOf(x.date))===y&&Number(x.date.slice(5,7))===i+1).reduce((a,x)=>a+Number(x.amount),0)); const current=byYear(year), prev=byYear(year-1); const idx=Array.from({length:12},(_,k)=>k);
    return { summary:{income,expense,balance:analyticFilter?income-expense:balance,openingBalance:opening,count:rows.length,averageIncome:active.length?income/active.length:0,averageExpense:active.length?expense/active.length:0,margin:income?((income-expense)/income)*100:0,bestMonth:labels[best[0]],bestMonthResult:best[1].income-best[1].expense}, monthly:{labels,income:monthly.map((m)=>m.income),expense:monthly.map((m)=>m.expense),balance:monthly.map((m)=>m.balance)}, categories:[...catMap.values()].sort((a,b)=>b.value-a.value), comparison:{labels:idx.map((i)=>monthNames[i]),currentYear:year,previousYear:year-1,current:idx.map((i)=>current[i]),previous:idx.map((i)=>prev[i])} };
  }


  async function listReports(filters = {}) { if (!useLocalData()) return request(`/api/relatorios${queryString(filters)}`); let reports=clone(readDemo().reports); if(filters.period&&filters.period!=="all")reports=reports.filter((r)=>r.period.startsWith(filters.period)); return {data:reports.sort((a,b)=>b.generated_at.localeCompare(a.generated_at)),count:reports.length}; }
  async function createReport(payload) { if (!useLocalData()) return (await request("/api/relatorios", {method:"POST",body:JSON.stringify(payload)})).relatorio; return mutateDemo((s)=>{ const id=s.next.report++; const names={fluxo:"Fluxo de caixa",livro:"Livro caixa",banco:"Relatório de banco",dre:"DRE simplificada",categorias:"Despesas por categoria",receber:"Contas a receber",pagar:"Contas a pagar"}; const report={id,type:payload.type||payload.tipo,name:names[payload.type||payload.tipo]||"Relatório",period:payload.period||"all",period_label:payload.period||"Todo o período",format:String(payload.format||"CSV").toUpperCase(),filters:{bank_id:payload.bank_id||null,category_id:payload.category_id||null},generated_at:new Date().toISOString(),download_url:"#"}; s.reports.push(report); return report; }); }
  async function downloadReport(report) {
    if (["livro", "fluxo", "banco"].includes(report.type)) {
      const source = demoMode
        ? { transactions: readDemo().transactions, banks: readDemo().banks, company: readDemo().settings.empresa || {} }
        : await request(`/api/relatorios/${encodeURIComponent(report.id)}/dados`);
      await global.CaixaReportExport.download(report, source);
      return;
    }
    if (!useLocalData()) { global.location.href = report.download_url; return; }
    const filters={period:report.period,...report.filters}; const rows=localFilteredTransactions(filters).sort((a,b)=>a.date.localeCompare(b.date)); const header=["Data","Fluxo","Descrição","Categoria","Banco origem","Banco destino","Documento","Valor"];
    if(report.format==="PDF"){
      const JsPDF=global.jspdf?.jsPDF; if(!JsPDF) throw new Error("A biblioteca de PDF não foi carregada."); const doc=new JsPDF({orientation:"landscape",unit:"mm",format:"a4"}); doc.setFontSize(16); doc.text(report.name,14,16); doc.setFontSize(10); doc.text(`Período: ${report.period}`,14,23); let y=32; doc.setFontSize(8); doc.text(header.join(" | "),14,y); y+=5; rows.forEach((r)=>{ const line=[r.date,r.type,r.description,r.category?.name||"",r.origin_bank||"",r.destination_bank||"",r.document_number,Number(r.amount).toFixed(2)].join(" | ").slice(0,190); if(y>190){doc.addPage();y=18;} doc.text(line,14,y);y+=4;}); doc.save(`${slug(report.name)}-${report.period}.pdf`); return;
    }
    const lines=[header,...rows.map((r)=>[r.date,r.type,r.description,r.category?.name||"",r.origin_bank||"",r.destination_bank||"",r.document_number,String(Number(r.amount).toFixed(2)).replace(".",",")])]; const csv="\ufeff"+lines.map((row)=>row.map((v)=>`"${String(v??"").replaceAll('"','""')}"`).join(";")).join("\n"); const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"})); const a=document.createElement("a");a.href=url;a.download=`${slug(report.name)}-${report.period}.csv`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }

  async function getGoalProgress() { return global.CaixaGoal.calculate(readDemo(), isoToday()); }

  async function getSettings(section) { if (demoMode && section === "saldo-inicial") return {amount:Number(readDemo().banks.find(bank=>bank.id === "banco-geral")?.initial_balance || 0)}; if (!useLocalData()) return (await request(`/api/configuracoes/${encodeURIComponent(section)}`)).configuracao||{}; return clone(readDemo().settings[section]||{}); }
  async function saveSettings(section,payload) {
    if (demoMode && section === "saldo-inicial") {
      const amount = Number(payload.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 999999999999.99) throw new Error("Informe um saldo inicial entre zero e R$ 999.999.999.999,99.");
      return mutateDemo(state => {
        const bank = state.banks.find(item => item.id === "banco-geral");
        if (!bank) throw new Error("Banco Geral não encontrado.");
        bank.initial_balance = Math.round(amount * 100) / 100;
        return {amount:bank.initial_balance};
      });
    }
 if (section === "objetivo") { const amount = Number(payload.amount); if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999999.99) throw new Error("Informe um objetivo maior que zero e de até R$ 999.999.999.999,99."); payload = { amount: Math.round(amount * 100) / 100 }; } if (!useLocalData()) return (await request(`/api/configuracoes/${encodeURIComponent(section)}`,{method:"PUT",body:JSON.stringify(payload)})).configuracao||payload; return mutateDemo((s)=>{s.settings[section]=clone(payload);return s.settings[section];}); }

  async function listNotifications() { if (!useLocalData()) return request("/api/notificacoes"); const data=clone(readDemo().notifications).sort((a,b)=>b.published_at.localeCompare(a.published_at)); return {data,count:data.length,unread_count:data.filter((x)=>!x.read).length}; }
  async function getNotificationCount() { if (!useLocalData()) return request("/api/notificacoes/contador"); return {unread_count:readDemo().notifications.filter((x)=>!x.read).length}; }
  async function markNotification(id,read=true) { if (!useLocalData()) return request(`/api/notificacoes/${encodeURIComponent(id)}/leitura`,{method:"PATCH",body:JSON.stringify({read})}); return mutateDemo((s)=>{const item=s.notifications.find((x)=>x.id===Number(id));if(item)item.read=read;return {read};}); }
  async function createNotification(payload) { if (!useLocalData()) return (await request("/api/notificacoes",{method:"POST",body:JSON.stringify(payload)})).notificacao; return mutateDemo((s)=>{const item={id:s.next.notification++,title:String(payload.title||"").trim(),message:String(payload.message||"").trim(),link:payload.link||null,published_at:new Date().toISOString(),read:false};s.notifications.unshift(item);return item;}); }

  async function endDemoSession() {
    global.sessionStorage.removeItem(demoKey);
    global.sessionStorage.removeItem(demoKey + ".before-general-bank");
    endTutorial();
    global.sessionStorage.removeItem("caixa-facil.tutorial.start");
    return { redirecionar: "/login.html" };
  }

  global.AndesData = Object.freeze({
    mode: demoMode ? "demo-local" : "flask-sqlalchemy", locale, currencyCode,
    listCategories, createCategory, updateCategory, deleteCategory,
    listBanks,
    listPeriods, listTransactions, getTransaction, createTransaction, updateTransaction, deleteTransaction, getAnalytics,
    listReports, createReport, downloadReport,
    getSettings, saveSettings, getGoalProgress,
    listNotifications, getNotificationCount, markNotification, createNotification,
    endDemoSession, beginTutorial, endTutorial, tutorialActive,
  });
})(window);
