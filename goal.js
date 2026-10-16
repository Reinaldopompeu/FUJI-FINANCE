(function (global) {
  "use strict";
  function dayNumber(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return NaN;
    const value = Date.parse(iso + "T00:00:00Z");
    return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === iso ? value / 86400000 : NaN;
  }
  function calculate(state, today) {
    const target = Number(state.settings?.objetivo?.amount || 0);
    const now = dayNumber(today);
    const rows = (state.transactions || []).filter((tx) =>
      tx.status !== "cancelado" && ["entrada", "saida"].includes(tx.type) &&
      Number.isFinite(Number(tx.amount)) && dayNumber(tx.date) <= now);
    const initial = (state.banks || []).filter((bank) => bank.active !== false)
      .reduce((sum, bank) => sum + Number(bank.initial_balance || 0), 0);
    const netCents = rows.reduce((sum, tx) => sum + (tx.type === "entrada" ? 1 : -1) * Math.round(Number(tx.amount) * 100), 0);
    const net = netCents / 100;
    const balance = Math.round((initial + net) * 100) / 100;
    const activeMonths = new Set(rows.map((tx) => tx.date.slice(0, 7))).size;
    const monthly = activeMonths ? net / activeMonths : 0;
    const remaining = Math.max(0, Math.round((target - balance) * 100) / 100);
    const status = !Number.isFinite(target) || target <= 0 ? "unset" : remaining <= 0 ? "reached" : !rows.length ? "empty" : monthly <= 0 ? "stalled" : "projected";
    const percent = status === "unset" ? null : Math.min(100, Math.max(0, balance / target * 100));
    return { target, balance, remaining, monthly, activeMonths, status, percent,
      months: status === "projected" ? Math.ceil(Math.round(remaining * 100) * activeMonths / netCents) : null };
  }
  function duration(months) {
    if (months < 12) return `${months} ${months === 1 ? "mês" : "meses"}`;
    const years = Math.floor(months / 12), remainder = months % 12;
    return `${years.toLocaleString("pt-BR")} ${years === 1 ? "ano" : "anos"}${remainder ? ` e ${remainder} ${remainder === 1 ? "mês" : "meses"}` : ""}`;
  }
  global.CaixaGoal = Object.freeze({ calculate, duration });
})(typeof window === "undefined" ? globalThis : window);
