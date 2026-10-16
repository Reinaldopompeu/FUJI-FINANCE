/* Guia de leitura: destaca recursos reais, sem executar ações financeiras. */
(function (global) {
  "use strict";
  document.addEventListener("DOMContentLoaded", () => {
    const dialog = document.getElementById("tutorialDialog");
    if (!dialog) return;
    const demo = document.body.dataset.demo === "true";
    const key = demo ? "caixa-facil.local.tutorial.v2" : `caixa-facil.tutorial.v2.${dialog.dataset.user}`;
    const steps = [...document.querySelectorAll("#tutorialSteps li")];
    let storage, state = { offered: false, running: false, complete: false, step: 0 };
    try {
      storage = demo ? global.localStorage : global.localStorage;
      const saved = JSON.parse(storage.getItem(key) || "null");
      if (saved && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < steps.length) state = saved;
    } catch (_) { /* O guia também funciona quando o armazenamento está indisponível. */ }
    let highlighted = null, previousFocus = null, invitation = false, celebrating = false;
    const next = dialog.querySelector("[data-tour-next]"), back = dialog.querySelector("[data-tour-back]");
    function save() { try { storage?.setItem(key, JSON.stringify(state)); } catch (_) {} }
    function updateNotice() {
      document.querySelectorAll("[data-tour-start]").forEach((button) => { button.textContent = state.complete ? "Rever tutorial" : state.offered && state.step > 0 ? "Retomar tutorial" : "Iniciar tutorial"; });
      const status = document.getElementById("tutorialNoticeStatus");
      if (status && state.complete) status.textContent = "Tutorial concluído. Você pode rever as orientações a qualquer momento.";
    }
    let guideTimer = null;
    const marked = new Set();
    const touched = new Set();
    function clearGuidance() {
      global.clearInterval(guideTimer); guideTimer = null;
      marked.forEach(element => element.classList.remove("tutorial-pending"));
      marked.clear();
    }
    function updateGuidance() {
      const desired = new Set();
      if (state.running && !dialog.open) {
        const action = steps[state.step]?.dataset.action;
        const selector = action === "categoryCreateForm" ? "#categoryCreateForm" : action === "transaction" ? "#transactionForm" : `[data-settings-form="${action?.replace("settings:", "")}"]`;
        const form = document.querySelector(selector);
        const visible = element => element && !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length > 0;
        if (visible(form)) {
          const controls = [...form.querySelectorAll("input[required], select[required]")].filter(control => !control.disabled && !control.closest('[hidden]'));
          controls.forEach(control => {
            const target = global.Dropdown?.get(control)?.trigger || control;
            if (!visible(target)) return;
            const value = String(control.value || "").trim();
            const money = control.hasAttribute("data-money-input") ? Number(value.replace(/\./g, "").replace(",", ".")) : null;
            const positive = control.id === "goalAmount" || control.id === "txValue";
            const invalid = !value || !control.validity.valid || (money !== null && (!Number.isFinite(money) || (positive ? money <= 0 : money < 0)));
            // Prefilled values are highlighted until reviewed once.
            if (invalid || !touched.has(control)) desired.add(target);
          });
          if (!desired.size) {
            const button = [...form.querySelectorAll('[data-transaction-next], button[type="submit"]')].find(visible);
            if (button && !button.disabled) desired.add(button);
          }
        } else {
          const trigger = document.querySelector(steps[state.step].dataset.target);
          if (visible(trigger)) desired.add(trigger);
        }
      }
      marked.forEach(element => { if (!desired.has(element)) { element.classList.remove("tutorial-pending"); marked.delete(element); } });
      desired.forEach(element => { if (!marked.has(element)) { element.classList.add("tutorial-pending"); marked.add(element); } });
    }
    function beginGuidance() {
      clearGuidance(); touched.clear(); updateGuidance();
      guideTimer = global.setInterval(updateGuidance, 300);
    }
    ["input", "change", "focusout"].forEach(name => document.addEventListener(name, event => {
      if (event.target.matches?.("input, select")) touched.add(event.target);
      updateGuidance();
    }));
    function clearHighlight() { highlighted?.classList.remove("tutorial-highlight"); highlighted = null; }
    function open() {
      if (!dialog.open) { previousFocus = document.activeElement; dialog.showModal(); }
      next.focus();
    }
    function pause() {
      const wasDemo = global.AndesData?.tutorialActive() || celebrating;
      global.AndesData?.endTutorial();
      state.running = false; save(); clearGuidance(); clearHighlight(); dialog.close(); updateNotice();
      if (previousFocus?.isConnected) previousFocus.focus();
      if (wasDemo) global.location.assign("/notificacoes.html");
    }
    function showStep() {
      clearGuidance();
      invitation = false; celebrating = false; back.hidden = false;
      const step = steps[state.step];
      const url = new URL(step.dataset.url, global.location.origin);
      if (global.location.pathname !== url.pathname && storage) { save(); global.location.assign(url.href); return; }
      clearHighlight();
      highlighted = document.querySelector(step.dataset.target);
      if (highlighted) { highlighted.classList.add("tutorial-highlight"); highlighted.scrollIntoView({ block: "center", behavior: "instant" }); }
      document.getElementById("tutorialTitle").textContent = step.dataset.title;
      document.getElementById("tutorialMessage").textContent = step.textContent;
      document.getElementById("tutorialProgress").textContent = `Passo ${state.step + 1} de ${steps.length}`;
      next.textContent = "Preencher agora";
      back.textContent = "Sair do guia";
      open();
    }
    function start() {
      state.step = 0;
      state.complete = false; state.running = true; state.offered = true;
      global.AndesData?.beginTutorial(); save();
      if (global.AndesData) { global.location.assign(steps[state.step].dataset.url); return; }
      showStep();
    }
    dialog.querySelector("[data-tour-close]").addEventListener("click", pause);
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); pause(); });
    document.querySelectorAll("[data-tour-start]").forEach((button) => button.addEventListener("click", start));
    back.addEventListener("click", pause);
    next.addEventListener("click", () => {
      if (celebrating) { celebrating = false; pause(); global.location.assign("/"); return; }
      if (invitation) { start(); return; }
      dialog.close(); clearHighlight();
      // Open the actual form; advancing requires a successful save event.
      document.querySelector("[data-settings-back]")?.click();
      document.querySelector(steps[state.step].dataset.target)?.click();
      beginGuidance();
    });
    document.addEventListener("caixa:tutorial-action", (event) => {
      if (!state.running || event.detail !== steps[state.step]?.dataset.action) return;
      if (state.step === steps.length - 1) {
        state.complete = true; state.running = false; save();
        global.AndesData?.endTutorial();
        clearGuidance(); clearHighlight(); updateNotice();
        celebrating = true;
        document.getElementById("tutorialProgress").textContent = "Tudo pronto!";
        document.getElementById("tutorialTitle").textContent = "🎉 Parabéns, você concluiu o tutorial!";
        document.getElementById("tutorialMessage").textContent = "Você já sabe usar o caixa! Os dados de demonstração foram descartados. Agora você pode cadastrar seus dados reais.";
        back.hidden = true;
        next.textContent = "Ir para o início";
        open();
        return;
      }
      state.step++; save();
      document.querySelector("[data-settings-back]")?.click();
      showStep();
    });
    if (global.sessionStorage?.getItem("caixa-facil.tutorial.start") === "1") {
      global.sessionStorage.removeItem("caixa-facil.tutorial.start");
      start();
      return;
    }
    updateNotice();
    if (state.running) {
      if (global.AndesData && !global.AndesData.tutorialActive()) { state.step = 0; global.AndesData.beginTutorial(); save(); global.location.assign(steps[0].dataset.url); }
      else showStep();
    }
    else if (!state.offered) start();
  });
})(window);
