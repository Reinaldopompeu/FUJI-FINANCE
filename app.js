(function initializeCaixaApp(global) {
  "use strict";

  const data = global.AndesData;
  const charts = new Map();
  let pageController = null;
  let activeCategories = [];
  let activeBanks = [];
  const runtimeSettings = { financeiro: { defaultPeriod: null, confirmDelete: true }, aparencia: { density: "comfortable", reducedMotion: false } };

  document.addEventListener("DOMContentLoaded", boot);

  async function boot() {
    refreshIcons();
    initializeSidebar();
    initializeLogout();
    initializeKeyboardShortcuts();
    initializeDialogKeyboard();
    initializePrintActions();
    initializeChartResize();
    initializeCardCarousel();
    await refreshCatalogCache();
    await loadRuntimeSettings();
    await initializePeriodFields();
    await initializeReportPeriodFields();
    initializeCurrencyMasks();
    initializeFilterCatalogs();
    initializeTransactionModal();
    initializeSettings();
    initializeCatalogManagement();
    initializeReportActions();
    initializeNotificationsBadge();
    initializeNotificationCreate();

    pageController = createPageController(document.body.dataset.page);
    if (pageController) {
      initializeFilters(pageController);
      await pageController.refresh();
    }

    document.addEventListener("caixa:data-changed", async () => {
      await refreshCatalogCache();
      refreshFilterCatalogs();
      pageController?.reset?.();
      await pageController?.refresh?.();
      await refreshNotificationBadge();
    });
  }

  function initializeDialogKeyboard() {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const dialog = document.querySelector('.modal-backdrop.open [role="dialog"]');
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
        .filter((element) => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length && !element.classList.contains("dropdown-native"));
      if (!controls.length) { event.preventDefault(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    });
  }

  function initializeCardCarousel() {
    document.querySelectorAll(".stats-grid").forEach((grid) => {
      const cards = [...grid.querySelectorAll(".stat-card")];
      if (cards.length < 2) return;
      const dots = document.createElement("div");
      dots.className = "carousel-dots";
      dots.setAttribute("role", "group");
      dots.setAttribute("aria-label", "Selecionar indicador financeiro");
      const buttons = cards.map((card, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "carousel-dot";
        button.setAttribute("aria-label", `Mostrar ${card.querySelector(".stat-label")?.textContent || `indicador ${index + 1}`}`);
        button.addEventListener("click", () => {
          const offset = card.getBoundingClientRect().left - grid.getBoundingClientRect().left;
          grid.scrollTo({
            left: grid.scrollLeft + offset,
            behavior: global.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
          });
        });
        dots.append(button);
        return button;
      });
      grid.after(dots);
      function update() {
        const left = grid.getBoundingClientRect().left;
        const distances = cards.map((card) => Math.abs(card.getBoundingClientRect().left - left));
        const active = distances.indexOf(Math.min(...distances));
        buttons.forEach((button, index) => {
          button.classList.toggle("is-active", index === active);
          if (index === active) button.setAttribute("aria-current", "true");
          else button.removeAttribute("aria-current");
        });
      }
      let frame;
      grid.addEventListener("scroll", () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(update);
      }, { passive: true });
      new ResizeObserver(update).observe(grid);
      update();
    });
  }

  function refreshIcons() { if (global.lucide) global.lucide.createIcons(); }

  function initializeSidebar() {
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("sidebarClose");
    const overlay = document.querySelector(".sidebar-overlay");
    if (!sidebar || !toggle) return;
    const mobile = global.matchMedia("(max-width: 768px)");
    const stored = global.localStorage.getItem("caixa.sidebarCollapsed") === "true";
    function setCollapsed(collapsed, persist = false) {
      document.body.classList.toggle("sidebar-collapsed", collapsed);
      toggle.setAttribute("aria-expanded", String(!collapsed));
      sidebar.toggleAttribute("inert", collapsed);
      sidebar.setAttribute("aria-hidden", String(collapsed));
      overlay?.setAttribute("aria-hidden", String(collapsed));
      if (overlay) overlay.tabIndex = collapsed ? -1 : 0;
      if (persist && !mobile.matches) global.localStorage.setItem("caixa.sidebarCollapsed", String(collapsed));
      global.setTimeout(() => global.dispatchEvent(new Event("caixa:resize")), 180);
    }
    setCollapsed(mobile.matches || stored);
    toggle.addEventListener("click", () => setCollapsed(!document.body.classList.contains("sidebar-collapsed"), true));
    overlay?.addEventListener("click", () => setCollapsed(true));
    sidebar.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => { if (mobile.matches) setCollapsed(true); }));
    mobile.addEventListener("change", (event) => setCollapsed(event.matches ? true : global.localStorage.getItem("caixa.sidebarCollapsed") === "true"));
  }

  function initializeLogout() {
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-logout]");
      if (!button) return;
      button.disabled = true;
      try {
        if (data?.mode === "demo-local") {
          const result = await data.endDemoSession();
          global.location.href = result.redirecionar || "/login";
          return;
        }
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
        const response = await fetch("/api/logout", { method: "POST", headers: { "X-CSRF-Token": csrf, Accept: "application/json" } });
        const result = await response.json();
        if (!response.ok) throw new Error(result.erro || "Não foi possível sair.");
        global.location.href = result.redirecionar || "/login";
      } catch (error) {
        button.disabled = false;
        showToast(error.message || "Não foi possível sair.", "error");
      }
    });
  }

  function initializeKeyboardShortcuts() {
    document.addEventListener("keydown", (event) => {
      if (event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector("[data-filter='search']")?.focus();
      }
    });
  }

  function initializePrintActions() {
    document.addEventListener("click", (event) => { if (event.target.closest("[data-print-page]")) global.print(); });
  }

  async function refreshCatalogCache() {
    if (!data) return;
    try {
      [activeCategories, activeBanks] = await Promise.all([data.listCategories(), data.listBanks()]);
    } catch (error) {
      handleDataError(error, "Não foi possível carregar categorias e bancos.");
    }
  }

  async function loadRuntimeSettings() {
    if (!data?.getSettings) return;
    try {
      const [financial, appearance] = await Promise.all([data.getSettings("financeiro"), data.getSettings("aparencia")]);
      runtimeSettings.financeiro = { ...runtimeSettings.financeiro, ...(financial || {}) };
      runtimeSettings.aparencia = { ...runtimeSettings.aparencia, ...(appearance || {}) };
      applyRuntimeSettings();
    } catch (error) {
      console.warn("Preferências não puderam ser aplicadas.", error);
    }
  }

  function applyRuntimeSettings() {
    document.body.classList.toggle("density-compact", runtimeSettings.aparencia.density === "compact");
    document.body.classList.toggle("reduce-motion", Boolean(runtimeSettings.aparencia.reducedMotion));
  }

  async function initializePeriodFields() {
    const selects = [...document.querySelectorAll("select[data-filter='period']")];
    if (!selects.length || !data?.listPeriods) return;
    try {
      const periods = await data.listPeriods();
      const monthFormatter = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
      const monthLabel = (value) => {
        const [year, month] = String(value).split("-").map(Number);
        const formatted = monthFormatter.format(new Date(Date.UTC(year, month - 1, 15)));
        return formatted.charAt(0).toUpperCase() + formatted.slice(1);
      };
      selects.forEach((select) => {
        const preferred = select.dataset.defaultPeriod || runtimeSettings.financeiro.defaultPeriod || "all";
        const desired = preferred === "year" ? periods.ano_atual : preferred === "month" ? periods.atual : "all";
        select.innerHTML = [
          '<option value="all">Todo o período</option>',
          ...(periods.anos || []).map((year) => `<option value="${escapeHtml(year)}">Ano de ${escapeHtml(year)}</option>`),
          ...(periods.meses || []).map((month) => `<option value="${escapeHtml(month)}">${escapeHtml(monthLabel(month))}</option>`),
        ].join("");
        select.value = [...select.options].some((option) => option.value === desired) ? desired : "all";
        if (select.hasAttribute("data-years-only")) {
          const years = [...new Set([String(periods.ano_atual), ...(periods.anos || []).map(String)])];
          select.innerHTML = years.map((year) => `<option value="${escapeHtml(year)}">Ano de ${escapeHtml(year)}</option>`).join("");
          select.value = String(periods.ano_atual);
        }
      });
    } catch (error) { handleDataError(error, "Não foi possível carregar os períodos."); }
  }

  async function initializeReportPeriodFields() {
    const fields = [...document.querySelectorAll("select[data-report-period-kind]")];
    if (!fields.length || !data?.listPeriods) return;
    try {
      const periods = await data.listPeriods();
      const formatter = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
      const monthLabel = (value) => {
        const [year, month] = String(value).split("-").map(Number);
        const formatted = formatter.format(new Date(Date.UTC(year, month - 1, 15)));
        return formatted.charAt(0).toUpperCase() + formatted.slice(1);
      };
      fields.forEach((field) => {
        const current = field.value;
        if (field.dataset.reportPeriodKind === "year") {
          const years = [...new Set([String(periods.ano_atual), ...(periods.anos || []).map(String)])];
          field.innerHTML = years.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join("");
          field.value = years.includes(current) ? current : String(periods.ano_atual || years[0] || "");
          return;
        }
        const months = [...new Set([String(periods.atual), ...(periods.meses || []).map(String)])];
        field.innerHTML = months.map((month) => `<option value="${escapeHtml(month)}">${escapeHtml(monthLabel(month))}</option>`).join("");
        field.value = months.includes(current) ? current : String(periods.atual || months[0] || "");
      });
    } catch (error) {
      handleDataError(error, "Não foi possível carregar os períodos dos relatórios.");
    }
  }

  function initializeCurrencyMasks() {
    document.querySelectorAll("[data-money-input]").forEach((field) => {
      if (field.dataset.moneyMaskReady === "true") return;
      field.dataset.moneyMaskReady = "true";
      const applyWhileTyping = () => {
        const start = field.selectionStart ?? field.value.length;
        const logicalBeforeCaret = [...field.value.slice(0, start)].filter((char) => /[0-9,-]/.test(char)).length;
        const formatted = formatCurrencyTyping(field.value);
        field.value = formatted;
        if (document.activeElement !== field) return;
        let logicalCount = 0;
        let nextCaret = formatted.length;
        for (let index = 0; index < formatted.length; index += 1) {
          if (/[0-9,-]/.test(formatted[index])) logicalCount += 1;
          if (logicalCount >= logicalBeforeCaret) { nextCaret = index + 1; break; }
        }
        field.setSelectionRange(nextCaret, nextCaret);
      };
      field.addEventListener("input", applyWhileTyping);
      field.addEventListener("blur", () => {
        if (!field.value.trim()) return;
        const value = parseCurrencyInput(field.value);
        if (Number.isFinite(value)) field.value = formatMoneyInput(value);
      });
      if (field.value) field.value = formatCurrencyTyping(field.value);
    });
  }

  function formatCurrencyTyping(value) {
    const raw = String(value || "").trim();
    const negative = raw.startsWith("-");
    const cleaned = raw.replace(/[^0-9,]/g, "");
    const hasDecimal = cleaned.includes(",");
    const [integerPart = "", ...fractionParts] = cleaned.split(",");
    const integerDigits = integerPart.replace(/\D/g, "").replace(/^0+(?=\d)/, "") || (hasDecimal ? "0" : "");
    const grouped = integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const fraction = fractionParts.join("").replace(/\D/g, "").slice(0, 2);
    return `${negative ? "-" : ""}${grouped}${hasDecimal ? `,${fraction}` : ""}`;
  }

  function initializeFilterCatalogs() {
    refreshFilterCatalogs();
  }

  function refreshFilterCatalogs() {
    document.querySelectorAll("select[data-filter='category_id']").forEach((select) => {
      const current = select.value || "all";
      select.innerHTML = ['<option value="all">Todas as categorias</option>', ...activeCategories.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`)].join("");
      select.value = [...select.options].some((x) => x.value === current) ? current : "all";
    });
    const reportBank = document.querySelector("[data-report-bank]");
    if (reportBank) {
      const current = reportBank.value;
      reportBank.innerHTML = ['<option value="">Selecione o banco</option>', ...activeBanks.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name)}</option>`)].join("");
      reportBank.value = "banco-geral";
    }
  }

  function initializeTransactionModal() {
    const backdrop = document.getElementById("transactionModal");
    const form = document.getElementById("transactionForm");
    if (!backdrop || !form || !data) return;

    const flux = document.getElementById("txFlux");
    const category = document.getElementById("txCategory");
    const categoryField = document.getElementById("txCategoryField");
    const categoryLabel = document.getElementById("txCategoryLabel");
    const originBank = document.getElementById("txOriginBank");
    const originBankField = document.getElementById("txOriginBankField");
    const destinationBank = document.getElementById("txDestinationBank");
    const destinationBankField = document.getElementById("txDestinationBankField");
    const dateField = document.getElementById("txDate");
    const amountField = document.getElementById("txValue");
    const descriptionField = document.getElementById("txDescription");
    const feedback = form.querySelector("[data-form-feedback]");
    const submit = form.querySelector("[data-submit-transaction]");
    const nextButton = form.querySelector("[data-transaction-next]");
    const previousButton = form.querySelector("[data-transaction-previous]");
    const stepLabel = document.getElementById("transactionStepLabel");
    const stepTitle = document.getElementById("txStepTwoTitle");
    const stepDescription = document.getElementById("txStepTwoDescription");
    const panels = [...form.querySelectorAll("[data-transaction-step]")];
    const fieldSteps = [...form.querySelectorAll("[data-field-step]")];
    const indicators = [...form.querySelectorAll("[data-step-indicator]")];
    let sequence = ["date", "type", "amount", "description", "review"];
    const touchedFields = new Set();
    let currentIndex = 0;
    let lastFocused = null;

    const flowNames = { entrada: "Entrada", saida: "Saída", transferencia: "Transferência" };

    function optionMarkup(items, placeholder) {
      return [`<option value="">${escapeHtml(placeholder)}</option>`, ...items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`)].join("");
    }

    function updateFieldValidation(control) {
      if (control === descriptionField) setText("#txDescriptionCount", `${control.value.length} / ${control.maxLength}`);
      const field = control?.closest(".field");
      if (!field) return;
      const unavailable = field.hidden || control.disabled || control.closest("[data-transaction-step]")?.hidden;
      const value = String(control.value || "").trim();
      const shouldValidate = control.required || Boolean(value);
      let valid = shouldValidate ? control.validity.valid : null;
      if (control === amountField) valid = parseCurrencyInput(value) > 0;
      if (control === descriptionField && shouldValidate) valid = value.length >= 2 && value.length <= 80;
      if (unavailable || !shouldValidate || !touchedFields.has(control)) valid = null;
      field.classList.remove("is-valid");
      field.classList.toggle("is-invalid", valid === false);
      if (valid === null) control.removeAttribute("aria-invalid");
      else control.setAttribute("aria-invalid", String(!valid));
      const dropdown = global.Dropdown?.get(control);
      if (dropdown?.trigger) {
        if (valid === null) dropdown.trigger.removeAttribute("aria-invalid");
        else dropdown.trigger.setAttribute("aria-invalid", String(!valid));
      }
    }

    function populateDestinationBanks() {
      const current = destinationBank.value;
      const items = activeBanks.filter((bank) => flux.value !== "transferencia" || bank.id !== originBank.value);
      destinationBank.innerHTML = optionMarkup(items, "Selecione o banco");
      destinationBank.value = "banco-geral";
      updateFieldValidation(destinationBank);
    }

    function configureFlow() {
      [category, originBank, destinationBank].forEach((control) => touchedFields.delete(control));
      const flow = flux.value;
      const isTransfer = flow === "transferencia";

      category.disabled = isTransfer || !flow;
      category.required = !isTransfer && Boolean(flow);
      category.value = "";
      category.innerHTML = optionMarkup(activeCategories.filter((item) => item.flow === flow), "Selecione a categoria");
      categoryLabel.firstChild.textContent = flow === "entrada" ? "Categoria da entrada " : "Categoria da saída ";

      originBank.disabled = !["saida", "transferencia"].includes(flow);
      originBank.required = !originBank.disabled;
      originBank.value = "";
      originBank.innerHTML = optionMarkup(activeBanks, "Banco Geral");
      originBank.value = "banco-geral";

      destinationBank.disabled = !["entrada", "transferencia"].includes(flow);
      destinationBank.required = !destinationBank.disabled;
      destinationBank.value = "";
      populateDestinationBanks();

      feedback.textContent = "";
      form.querySelectorAll(".field").forEach((field) => field.classList.remove("is-valid", "is-invalid"));
      rebuildSequence();
    }

    function selectedLabel(select, fallback = "Não informado") {
      const option = select?.selectedOptions?.[0];
      return select?.value && option ? option.textContent.trim() : fallback;
    }

    function focusControl(control) {
      (global.Dropdown?.get(control)?.trigger || control)?.focus();
    }

    const fieldConfig = {
      category: { control: category, title: "Selecione a categoria", description: "Escolha a classificação principal deste lançamento." },
      "origin-bank": { control: originBank, title: "Selecione o banco de origem", description: "Informe de qual conta o valor será retirado." },
      "destination-bank": { control: destinationBank, title: "Selecione o banco de destino", description: "Informe em qual conta o valor será recebido." },
      date: { control: dateField, title: "Informe a data", description: "Escolha a data efetiva da movimentação." },
      amount: { control: amountField, title: "Informe o valor", description: "Digite o valor total do lançamento." },
      description: { control: descriptionField, title: "Descreva o lançamento", description: "Use uma descrição curta e fácil de reconhecer." },
    };

    function rebuildSequence() {
      const flow = flux.value;
      if (!flow) {
        sequence = ["date", "type", "amount", "description", "review"];
        return;
      }
      let fields = [];
      if (flow === "entrada") fields = ["category"];
      if (flow === "saida") fields = ["category"];
      if (flow === "transferencia") fields = ["origin-bank", "destination-bank"];
      sequence = ["date", "type", "amount", ...fields, "description", "review"];
    }

    function validateCurrentStep() {
      feedback.textContent = "";
      const key = sequence[currentIndex];
      if (key === "type") {
        if (flowNames[flux.value]) return true;
        feedback.textContent = "Selecione o tipo do lançamento.";
        touchedFields.add(flux);
        updateFieldValidation(flux);
        focusControl(flux);
        return false;
      }
      if (key === "review") return true;
      const control = fieldConfig[key]?.control;
      if (!control) return true;
      touchedFields.add(control);
      updateFieldValidation(control);
      const amountInvalid = control === amountField && !(parseCurrencyInput(control.value) > 0);
      if (!control.checkValidity() || amountInvalid) {
        feedback.textContent = amountInvalid ? "Informe um valor maior que zero." : "Preencha este campo para continuar.";
        focusControl(control);
        return false;
      }
      if (key === "destination-bank" && flux.value === "transferencia" && originBank.value === destinationBank.value) {
        feedback.textContent = "Escolha bancos diferentes para origem e destino.";
        focusControl(destinationBank);
        return false;
      }
      return true;
    }

    function setReviewValue(name, value) {
      const element = form.querySelector(`[data-review='${name}']`);
      if (element) element.textContent = value || "Não informado";
    }

    function renderReview() {
      const transfer = flux.value === "transferencia";
      setReviewValue("flow", flowNames[flux.value]);
      setReviewValue("date", formatDate(dateField.value));
      setReviewValue("amount", formatCurrency(parseCurrencyInput(amountField.value)));
      setReviewValue("category", selectedLabel(category));
      setReviewValue("origin-bank", selectedLabel(originBank));
      setReviewValue("destination-bank", selectedLabel(destinationBank));
      setReviewValue("description", descriptionField.value.trim());
      form.querySelector("[data-review-row='category']").hidden = transfer;
      form.querySelector("[data-review-row='origin-bank']").hidden = flux.value === "entrada";
      form.querySelector("[data-review-row='destination-bank']").hidden = flux.value === "saida";
    }

    function showStep(index, focus = true) {
      currentIndex = Math.max(0, Math.min(sequence.length - 1, index));
      const key = sequence[currentIndex];
      const phase = key === "review" ? 3 : ["date", "type", "amount"].includes(key) ? 1 : 2;
      panels.forEach((panel) => { panel.hidden = panel.dataset.transactionStep !== (key === "type" ? "type" : key === "review" ? "review" : "data"); });
      fieldSteps.forEach((field) => { field.hidden = field.dataset.fieldStep !== key; });
      form.querySelectorAll("input, select").forEach(updateFieldValidation);
      indicators.forEach((indicator) => {
        const value = Number(indicator.dataset.stepIndicator);
        indicator.classList.toggle("is-active", value === phase);
        indicator.classList.toggle("is-complete", value < phase);
        if (value === phase) indicator.setAttribute("aria-current", "step");
        else indicator.removeAttribute("aria-current");
      });
      stepLabel.textContent = !flux.value ? `Etapa ${currentIndex + 1}` : `Etapa ${currentIndex + 1} de ${sequence.length}`;
      previousButton.hidden = currentIndex === 0;
      nextButton.hidden = key === "review";
      submit.hidden = key !== "review";
      feedback.textContent = "";
      if (key !== "type" && key !== "review") {
        stepTitle.textContent = fieldConfig[key].title;
        stepDescription.textContent = fieldConfig[key].description;
      }
      if (key === "review") renderReview();
      if (!focus) return;
      const target = key === "review"
        ? submit
        : key === "type"
          ? global.Dropdown?.get(flux)?.trigger || flux
          : global.Dropdown?.get(fieldConfig[key].control)?.trigger || fieldConfig[key].control;
      global.setTimeout(() => target?.focus(), 20);
    }

    function moveNext() {
      if (!validateCurrentStep()) return;
      const currentKey = sequence[currentIndex];
      rebuildSequence();
      const position = sequence.indexOf(currentKey);
      showStep(Math.min(position + 1, sequence.length - 1));
    }

    flux.addEventListener("change", configureFlow);
    originBank.addEventListener("change", populateDestinationBanks);
    function validateEditedField(event) {
      touchedFields.add(event.target);
      updateFieldValidation(event.target);
    }
    form.addEventListener("input", validateEditedField);
    form.addEventListener("change", validateEditedField);
    form.addEventListener("invalid", validateEditedField, true);
    nextButton.addEventListener("click", moveNext);
    previousButton.addEventListener("click", () => showStep(currentIndex - 1));

    function clearForm() {
      form.reset();
      touchedFields.clear();
      dateField.value = localIsoDate();
      configureFlow();
      showStep(0, false);
      feedback.textContent = "";
      global.setTimeout(() => form.querySelectorAll("input, select").forEach(updateFieldValidation));
    }

    async function openModal(trigger) {
      lastFocused = trigger || document.activeElement;
      await refreshCatalogCache();
      clearForm();
      backdrop.classList.add("open");
      backdrop.setAttribute("aria-hidden", "false");
      document.body.classList.add("modal-open");
      global.setTimeout(() => focusControl(dateField), 20);
    }

    function closeModal() {
      backdrop.classList.remove("open");
      backdrop.setAttribute("aria-hidden", "true");
      document.body.classList.remove("modal-open");
      if (lastFocused instanceof HTMLElement) lastFocused.focus();
    }

    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-open-transaction]");
      if (trigger) void openModal(trigger);
      if (event.target.closest("[data-close-modal]")) closeModal();
    });
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeModal(); });
    document.addEventListener("keydown", (event) => {
      if (backdrop.classList.contains("open") && event.key === "Escape") {
        event.preventDefault();
        closeModal();
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (sequence[currentIndex] !== "review") {
        moveNext();
        return;
      }

      const flow = flux.value;
      const payload = {
        flow,
        date: dateField.value,
        amount: parseCurrencyInput(amountField.value),
        description: descriptionField.value.trim(),
        origin_type: flow === "entrada" ? "categoria" : "banco",
        origin_id: flow === "entrada" ? category.value : originBank.value,
        destination_type: flow === "saida" ? "categoria" : "banco",
        destination_id: flow === "saida" ? category.value : destinationBank.value,
      };

      submit.disabled = true;
      feedback.textContent = "Salvando…";
      try {
        const transaction = await data.createTransaction(payload);
        document.dispatchEvent(new CustomEvent("caixa:tutorial-action",{detail:"transaction"}));
        closeModal();
        showToast(`${transaction.description} foi adicionado com sucesso.`);
        document.dispatchEvent(new CustomEvent("caixa:data-changed", { detail: transaction }));
      } catch (error) {
        feedback.textContent = error.message || "Não foi possível salvar.";
        handleDataError(error, feedback.textContent);
      } finally {
        submit.disabled = false;
      }
    });
  }
  function initializeFilters(controller) {
    let timer = null;
    document.querySelectorAll("[data-filter]").forEach((field) => {
      const eventName = field.matches("input[type='search']") ? "input" : "change";
      field.addEventListener(eventName, () => {
        controller.reset?.();
        global.clearTimeout(timer);
        timer = global.setTimeout(() => controller.refresh(), eventName === "input" ? 250 : 0);
      });
    });
  }

  function getFilters() {
    return [...document.querySelectorAll("[data-filter]")].reduce((filters, field) => { filters[field.dataset.filter] = field.value; return filters; }, {});
  }

  function createPageController(page) {
    if (page === "dashboard") return createDashboardController();
    if (page === "lancamentos") return createTransactionsController();
    if (page === "graficos") return createChartsController();
    if (page === "relatorios") return createReportsController();
    if (page === "notificacoes") return createNotificationsController();
    return null;
  }

  function createDashboardController() {
    let requestId = 0, chartYear = 2026;
    const chartView = document.querySelector("[data-dashboard-chart-view]");
    const previous = document.querySelector("[data-chart-year-prev]");
    const next = document.querySelector("[data-chart-year-next]");
    const controller = { async refresh() {
      const id = ++requestId;
      setText("[data-chart-year]", String(chartYear));
      if (previous) previous.disabled = chartYear <= 1;
      if (next) next.disabled = chartYear >= 9999;
      setPageBusy(true);
      try {
        const [analytics, goal, yearly] = await Promise.all([
          data.getAnalytics(getFilters()), data.getGoalProgress(),
          data.getAnalytics({period: String(chartYear).padStart(4, "0")})
        ]);
        if (id !== requestId) return;
        renderGoal(goal);
        setText("[data-stat='balance']", formatCurrency(analytics.summary.balance || 0));
        const cashflow = chartView?.value === "cashflow";
        if (cashflow) renderCashflowChart(yearly.monthly, "balanceChart", "line");
        else renderBalanceChart(yearly.monthly, "balanceChart");
        document.getElementById("balanceChart")?.setAttribute("aria-label", `${cashflow ? "Entradas e saídas" : "Saldo acumulado"} em ${chartYear}`);
      } catch (error) { handleDataError(error); }
      finally { if (id === requestId) setPageBusy(false); }
    } };
    chartView?.addEventListener("change", () => { void controller.refresh(); });
    previous?.addEventListener("click", () => { if (chartYear > 1) { chartYear--; void controller.refresh(); } });
    next?.addEventListener("click", () => { if (chartYear < 9999) { chartYear++; void controller.refresh(); } });
    return controller;
  }

  function createTransactionsController() {
    const tbody = document.getElementById("transactionsTableBody"); const count = document.getElementById("transactionsCount"); const pagination = document.getElementById("transactionsPagination");
    const state = { page: 1, pageSize: 10, requestId: 0 };
    pagination?.addEventListener("click", (event) => { const button = event.target.closest("[data-page]"); if (!button || button.disabled) return; state.page = Number(button.dataset.page); controller.refresh(); });
    const controller = { reset() { state.page = 1; }, async refresh() { const id = ++state.requestId; setPageBusy(true); try { const result = await data.listTransactions({ ...getFilters(), page: state.page, pageSize: state.pageSize }); if (id !== state.requestId) return; const pages = Math.max(1, Math.ceil(result.count / state.pageSize)); if (state.page > pages) { state.page = pages; return controller.refresh(); } tbody.innerHTML = result.data.length ? result.data.map(transactionRow).join("") : emptyTableRow(7, "Nenhum lançamento encontrado para estes filtros."); count.textContent = `Mostrando ${result.data.length} de ${result.count} lançamentos`; renderPagination(pagination, state.page, pages); refreshIcons(); } catch (error) { tbody.innerHTML = emptyTableRow(7, "Não foi possível carregar os lançamentos.", true); handleDataError(error); } finally { if (id === state.requestId) setPageBusy(false); } } };
    tbody.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-delete-transaction]");
      if (!button || button.disabled) return;
      button.disabled = true;
      try {
        const transaction = await data.getTransaction(button.dataset.deleteTransaction);
        if (!transaction) { await controller.refresh(); return; }
        const message = `Excluir o lançamento “${transaction.description}” de ${formatCurrency(transaction.amount)}, em ${formatDate(transaction.date)}?\n\nO lançamento será removido e os saldos serão recalculados.`;
        if (!global.confirm(message)) return;
        await data.deleteTransaction(transaction.id);
        await refreshCatalogCache();
        await controller.refresh();
        showToast("Lançamento excluído. Saldos atualizados.");
      } catch (error) {
        handleDataError(error, "Não foi possível excluir o lançamento. Tente novamente.");
      } finally {
        button.disabled = false;
      }
    });
    return controller;
  }

  function createChartsController() {
    let requestId = 0; let lastAnalytics = null;
    const chartStyle = document.getElementById("chartStyle");
    chartStyle.addEventListener("change", () => { if (lastAnalytics) renderSelectedAnalysis(lastAnalytics); });
    function renderSelectedAnalysis(analytics) {
      const hasValues = [...analytics.monthly.income, ...analytics.monthly.expense].some(Number);
      if (!hasValues) {
        setChartOption("analysisChart", { series: [], graphic: [{ type: "text", left: "center", top: "middle", style: { text: "Sem dados para esta análise e filtros", ...chartTextStyle(), fill: chartColor("--ui-text-muted") } }] });
        return;
      }
      renderCashflowChart(analytics.monthly, "analysisChart", chartStyle.value);
    }
    const controller = { async refresh() { const id = ++requestId; lastAnalytics = null; setPageBusy(true); try { const analytics = await data.getAnalytics(getFilters()); if (id !== requestId) return; lastAnalytics = analytics; const margin = Number(analytics.summary.margin || 0); setText("[data-stat='average-income']", formatCurrency(analytics.summary.averageIncome, 0)); setText("[data-stat='average-expense']", formatCurrency(analytics.summary.averageExpense, 0)); setText("[data-stat='margin']", formatPercent(margin)); setText("[data-stat='best-month']", Number(analytics.summary.income) || Number(analytics.summary.expense) ? analytics.summary.bestMonth : "—"); const marginCard = document.querySelector("[data-stat='margin']")?.closest(".stat-card"); marginCard?.classList.toggle("is-negative", margin < 0); marginCard?.classList.toggle("is-positive", margin > 0); renderSelectedAnalysis(analytics); } catch (error) { handleDataError(error); } finally { if (id === requestId) setPageBusy(false); } } };
    return controller;
  }


  function createReportsController() {
    return { async refresh() { /* A página gera relatórios sob demanda; não há histórico visual. */ } };
  }

  function createNotificationsController() {
    let requestId=0; const list=document.getElementById("notificationsList"); const unread=document.getElementById("notificationsUnread");
    list?.addEventListener("click",async(event)=>{const button=event.target.closest("[data-notification-read]"); if(!button)return; button.disabled=true; try{await data.markNotification(button.dataset.notificationRead,button.dataset.read!=="false"); await controller.refresh(); await refreshNotificationBadge();}catch(error){handleDataError(error,"Não foi possível atualizar a notificação.");}finally{button.disabled=false;}});
    const controller={async refresh(){const id=++requestId; if(!list)return; setPageBusy(true); try{const result=await data.listNotifications(); if(id!==requestId)return; unread.textContent=result.unread_count?`${result.unread_count} não lida(s)`:"Tudo lido"; list.innerHTML=result.data.length?result.data.map(notificationItem).join(""):'<div class="table-empty"><span>Nenhum comunicado publicado.</span></div>';refreshIcons();}catch(error){list.innerHTML='<div class="table-empty error"><span>Não foi possível carregar as notificações.</span></div>';handleDataError(error);}finally{if(id===requestId)setPageBusy(false);}}}; return controller;
  }

  function initializeReportActions() {
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-generate-report]"); if (!button) return;
      const type = button.dataset.generateReport; const format = button.dataset.reportFormat || "CSV"; const periodField = document.querySelector(`[data-report-period='${CSS.escape(type)}']`); const period = periodField?.value || "all";
      if (!period) { showToast("Selecione o período do relatório.", "error"); periodField?.focus(); return; }
      const filters = getFilters();
      const payload = { type, period, format };
      if (type !== "banco") {
        if (filters.category_id && filters.category_id !== "all") payload.category_id = filters.category_id;
      }
      if (type === "banco") { const bank=document.querySelector("[data-report-bank]"); if(!bank?.value){showToast("Selecione o banco.","error");bank?.focus();return;} payload.bank_id=bank.value; }
      button.disabled=true;
      try { const report=await data.createReport(payload); showToast(`${report.name} gerado em ${report.format}.`); await pageController?.refresh?.(); await data.downloadReport(report); }
      catch(error){handleDataError(error,"Não foi possível gerar o relatório.");}
      finally{button.disabled=false;}
    });
    document.addEventListener("click", async (event)=>{const link=event.target.closest("[data-download-report]"); if(!link)return; if(data.mode!=="demo-local")return; event.preventDefault(); try{const reports=await data.listReports(); const report=reports.data.find((x)=>String(x.id)===link.dataset.downloadReport); if(report)await data.downloadReport(report);}catch(error){handleDataError(error,"Não foi possível baixar o relatório.");}});
  }

  async function initializeSettings() {
    if (!data) return;
    const settingsHome = document.querySelector("[data-settings-home]");
    const settingsPanels = [...document.querySelectorAll("[data-settings-panel]")];
    const settingsTriggers = [...document.querySelectorAll("[data-settings-target]")];
    let lastSettingsTrigger = null;

    function showSettingsHome({ restoreFocus = false } = {}) {
      settingsHome?.removeAttribute("hidden");
      settingsPanels.forEach((panel) => { panel.hidden = true; });
      if (global.location.hash.startsWith("#config-")) global.history.replaceState(null, "", global.location.pathname + global.location.search);
      if (restoreFocus) lastSettingsTrigger?.focus();
      global.scrollTo({ top: 0, behavior: global.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }

    function showSettingsPanel(name, trigger = null) {
      const panel = settingsPanels.find((item) => item.dataset.settingsPanel === name);
      if (!panel) return;
      if (trigger) lastSettingsTrigger = trigger;
      settingsHome?.setAttribute("hidden", "");
      settingsPanels.forEach((item) => { item.hidden = item !== panel; });
      global.history.replaceState(null, "", `#config-${name}`);
      global.scrollTo({ top: 0, behavior: "auto" });
      panel.querySelector("[data-settings-back]")?.focus();
    }

    settingsTriggers.forEach((trigger) => trigger.addEventListener("click", () => showSettingsPanel(trigger.dataset.settingsTarget, trigger)));
    document.querySelectorAll("[data-settings-back]").forEach((button) => button.addEventListener("click", () => showSettingsHome({ restoreFocus: true })));
    const requestedPanel = global.location.hash.match(/^#config-(objetivo|categorias|saldo-inicial)$/)?.[1];
    if (requestedPanel) showSettingsPanel(requestedPanel);

    document.querySelectorAll("[data-settings-form]").forEach(async (form) => {
      const section=form.dataset.settingsForm; const feedback=form.querySelector("[data-settings-feedback]");
      try{const saved=await data.getSettings(section); Object.entries(saved||{}).forEach(([name,value])=>{const field=form.elements[name];if(!field)return;if(field.type==="checkbox")field.checked=Boolean(value);else field.value=field.hasAttribute("data-money-input")?formatMoneyInput(value):value;});}
      catch(error){if(feedback)feedback.textContent="Não foi possível carregar esta seção.";}
      form.addEventListener("submit",async(event)=>{event.preventDefault();if(!form.reportValidity())return;const button=form.querySelector("button[type='submit']");const payload={};[...form.elements].forEach((field)=>{if(!field.name)return;payload[field.name]=field.type==="checkbox"?field.checked:field.hasAttribute("data-money-input")?parseCurrencyInput(field.value):field.value;});button.disabled=true;if(feedback)feedback.textContent="Salvando…";try{await data.saveSettings(section,payload);if(section==="financeiro")runtimeSettings.financeiro={...runtimeSettings.financeiro,...payload};if(section==="aparencia")runtimeSettings.aparencia={...runtimeSettings.aparencia,...payload};applyRuntimeSettings();if(feedback)feedback.textContent="Alterações salvas com sucesso.";showToast("Configurações salvas.");document.dispatchEvent(new CustomEvent("caixa:tutorial-action",{detail:"settings:"+section}));}catch(error){if(feedback)feedback.textContent=error.message||"Não foi possível salvar.";handleDataError(error,"Não foi possível salvar as configurações.");}finally{button.disabled=false;}});
    });
  }

  function renderGoal(goal) {
    setText("[data-stat='net-average']", formatCurrency(goal.monthly));
    document.querySelector(".stat-card-average")?.classList.toggle("is-negative", goal.monthly < 0);
    const progress = document.querySelector("[data-goal-percent]");
    if (progress) {
      progress.hidden = goal.percent === null;
      progress.textContent = goal.percent === null ? "" : `(${goal.percent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)`;
      progress.setAttribute("aria-label", goal.percent === null ? "Defina um objetivo para calcular a porcentagem" : `${progress.textContent} do objetivo concluído`);
    }
    const labels = { unset: "Defina seu objetivo", reached: "Objetivo atingido!", empty: "Sem histórico", stalled: "Sem previsão" };
    setText("[data-goal-value]", goal.status === "projected" ? global.CaixaGoal.duration(goal.months) : labels[goal.status]);
    const link = document.querySelector(".goal-link");
    if (link) { link.innerHTML = `${goal.status === "unset" ? "Definir objetivo" : "Ajustar objetivo"} <i data-lucide="arrow-up-right" aria-hidden="true"></i>`; refreshIcons(); }
    const card = document.querySelector(".stat-card-goal");
    if (card) card.title = "Estimativa com entradas menos saídas até hoje, divididas apenas pelos meses com lançamentos. Meses sem movimentações não entram na média. O prazo é arredondado para cima em meses completos.";
  }

  function initializeCatalogManagement() {
    const categoryForm=document.getElementById("categoryCreateForm"), bankForm=document.getElementById("bankCreateForm");
    renderCatalogs();
    categoryForm?.addEventListener("submit",async(event)=>{event.preventDefault();if(!categoryForm.reportValidity())return;await runCatalogCreate(categoryForm,()=>data.createCategory(Object.fromEntries(new FormData(categoryForm))),"Categoria adicionada.");});
    bankForm?.addEventListener("submit",async(event)=>{event.preventDefault();if(!bankForm.reportValidity())return;const payload=Object.fromEntries(new FormData(bankForm));const initial=parseCurrencyInput(payload.initial_balance);if(!Number.isFinite(initial)){showToast("Informe um saldo inicial válido.","error");document.getElementById("newBankInitialBalance")?.focus();return;}payload.initial_balance=initial;await runCatalogCreate(bankForm,()=>data.createBank(payload),"Banco criado com saldo inicial definido.");});


    document.addEventListener("click",async(event)=>{
      const edit=event.target.closest("[data-catalog-edit]"); if(edit){openCatalogEdit(edit.dataset.catalogType,edit.dataset.catalogEdit);return;}
      const del=event.target.closest("[data-catalog-delete]"); if(!del)return;
      const type=del.dataset.catalogType,id=del.dataset.catalogDelete; const item=findCatalogItem(type,id); if(!item)return;
      if(runtimeSettings.financeiro.confirmDelete !== false && !global.confirm(`Excluir “${item.name}”? Esta ação só será permitida se não houver vínculos.`))return;
      del.disabled=true;
      try{if(type==="categoria")await data.deleteCategory(id);else if(type==="banco")await data.deleteBank(id);showToast("Cadastro excluído.");await refreshCatalogCache();renderCatalogs();refreshFilterCatalogs();}
      catch(error){handleDataError(error,error.message||"Não foi possível excluir.");}
      finally{del.disabled=false;}
    });

    const modal=document.getElementById("catalogEditModal"), editForm=document.getElementById("catalogEditForm");
    if (editForm) {
      const field = document.createElement("div");
      field.className = "field full"; field.id = "catalogEditFlowField"; field.hidden = true;
      field.innerHTML = '<label for="catalogEditFlow">Fluxo da categoria</label><select class="select" id="catalogEditFlow"><option value="entrada">Entrada</option><option value="saida">Saída</option></select>';
      editForm.querySelector(".modal-body").prepend(field);
      global.Dropdown?.enhance(field);
    }
    function openCatalogEdit(type,id){
      if(!modal||!editForm)return;
      const item=findCatalogItem(type,id);if(!item)return;
      document.getElementById("catalogEditType").value=type;
      document.getElementById("catalogEditId").value=id;
      document.getElementById("catalogEditName").value=item.name;
      document.getElementById("catalogEditFlowField").hidden = type !== "categoria";
      document.getElementById("catalogEditFlow").disabled = type !== "categoria";
      document.getElementById("catalogEditFlow").value = item.flow || "saida";
      const colorField=document.getElementById("catalogEditColorField");
      const initialField=document.getElementById("catalogEditInitialBalanceField");
      colorField.hidden=false;
      if(initialField) initialField.hidden=type!=="banco";
      document.getElementById("catalogEditColor").value=item.color||"#64748b";
      if(type==="banco") document.getElementById("catalogEditInitialBalance").value=formatMoneyInput(item.initial_balance||0);
      const labels={categoria:"categoria",banco:"banco"};
      document.getElementById("catalogEditTitle").textContent=`Editar ${labels[type]||"item"}`;
      modal.classList.add("open");modal.setAttribute("aria-hidden","false");document.body.classList.add("modal-open");document.getElementById("catalogEditName").focus();
    }
    function closeEdit(){if(!modal)return;modal.classList.remove("open");modal.setAttribute("aria-hidden","true");document.body.classList.remove("modal-open");}
    modal?.querySelectorAll("[data-close-catalog-edit]").forEach((button)=>button.addEventListener("click",closeEdit)); modal?.addEventListener("click",(event)=>{if(event.target===modal)closeEdit();});
    editForm?.addEventListener("submit",async(event)=>{event.preventDefault();if(!editForm.reportValidity())return;const type=document.getElementById("catalogEditType").value,id=document.getElementById("catalogEditId").value;const payload={name:document.getElementById("catalogEditName").value.trim()};if(type==="categoria")payload.flow=document.getElementById("catalogEditFlow").value;payload.color=document.getElementById("catalogEditColor").value;if(type==="banco"){const initial=parseCurrencyInput(document.getElementById("catalogEditInitialBalance").value);if(!Number.isFinite(initial)){showToast("Informe um saldo inicial válido.","error");return;}payload.initial_balance=initial;}const button=editForm.querySelector("button[type='submit']");button.disabled=true;try{if(type==="categoria")await data.updateCategory(id,payload);else if(type==="banco")await data.updateBank(id,payload);closeEdit();showToast("Cadastro atualizado.");await refreshCatalogCache();renderCatalogs();refreshFilterCatalogs();}catch(error){editForm.querySelector("[data-catalog-edit-feedback]").textContent=error.message||"Não foi possível salvar.";handleDataError(error,error.message);}finally{button.disabled=false;}});
  }

  async function runCatalogCreate(form,action,message){const button=form.querySelector("button[type='submit']");button.disabled=true;try{await action();form.reset();const color=form.querySelector("input[type='color']");if(color)color.value=form.id==="bankCreateForm"?"#2563eb":"#64748b";if(form.id==="bankCreateForm"){const initial=document.getElementById("newBankInitialBalance");if(initial)initial.value="0,00";}showToast(message);await refreshCatalogCache();renderCatalogs();refreshFilterCatalogs();document.dispatchEvent(new CustomEvent("caixa:tutorial-action",{detail:form.id}));}catch(error){handleDataError(error,error.message||"Não foi possível adicionar o cadastro.");}finally{button.disabled=false;}}
  function findCatalogItem(type,id){const source=type==="categoria"?activeCategories:type==="banco"?activeBanks:[];return source.find((x)=>String(x.id)===String(id));}
  function renderCatalogs(){
    renderCatalogList("settingsCategoryList",activeCategories,"categoria");
    renderCatalogList("settingsBankList",activeBanks,"banco");
    groupBankRows();
    setText("#categoryCount",String(activeCategories.length));setText("#bankCount",String(activeBanks.length));
    setText("#bankInitialTotal",formatCurrency(activeBanks.reduce((sum,item)=>sum+Number(item.initial_balance||0),0)));
    setText("#bankCurrentTotal",formatCurrency(activeBanks.reduce((sum,item)=>sum+Number(item.current_balance??item.initial_balance??0),0)));
    refreshIcons();
  }
  function renderCatalogList(id,items,type){
    const container=document.getElementById(id);if(!container)return;const manageable=Boolean(document.getElementById("catalogEditModal"));
    if(!items.length){container.innerHTML='<div class="catalog-empty"><i data-lucide="inbox"></i><span>Nenhum cadastro encontrado.</span></div>';return;}
    const actions=(item)=>manageable?`<div class="catalog-actions"><button class="icon-button category-action" type="button" data-catalog-edit="${escapeHtml(item.id)}" data-catalog-type="${type}" aria-label="Editar ${escapeHtml(item.name)}"><i data-lucide="pencil"></i></button><button class="icon-button category-action danger" type="button" data-catalog-delete="${escapeHtml(item.id)}" data-catalog-type="${type}" aria-label="Excluir ${escapeHtml(item.name)}"><i data-lucide="trash-2"></i></button></div>`:"";

    container.innerHTML=items.map((item)=>{
      if(type==="banco")return `<div class="catalog-row bank-row"><div class="catalog-identity"><span class="catalog-color" style="--catalog-color:${escapeHtml(item.color||"#2563eb")}"><i data-lucide="landmark"></i></span><div><strong>${escapeHtml(item.name)}</strong><small>${Number(item.usage_count||0)} movimentação(ões)</small></div></div><div class="bank-row-balances"><span>Saldo inicial<strong>${formatCurrency(item.initial_balance||0)}</strong></span><span>Saldo atual<strong class="${Number(item.current_balance||0)<0?"negative-value":""}">${formatCurrency(item.current_balance??item.initial_balance??0)}</strong></span></div>${actions(item)}</div>`;
      return `<div class="catalog-row"><div class="catalog-identity"><span class="catalog-color" style="--catalog-color:${escapeHtml(item.color||"#64748b")}"><i data-lucide="tag"></i></span><div><strong>${escapeHtml(item.name)}</strong><small>${Number(item.usage_count||0)} lançamento(s)</small></div></div>${actions(item)}</div>`;
    }).join("");
  }

  function groupBankRows() {
    const container = document.getElementById("settingsBankList");
    if (!container) return;
    const groups = new Map();
    [...container.querySelectorAll(".bank-row")].forEach((row, index) => {
      const name = "Disponível";
      if (!groups.has(name)) {
        const section = document.createElement("section");
        section.className = "catalog-subgroup";
        const header = document.createElement("div");
        header.className = "catalog-subgroup-header";
        const title = document.createElement("strong");
        title.textContent = name;
        header.append(title); section.append(header); groups.set(name, section);
      }
      groups.get(name).append(row);
    });
    if (groups.size) container.replaceChildren(...groups.values());
  }
  function initializeNotificationsBadge(){void refreshNotificationBadge();}
  async function refreshNotificationBadge(){const badge=document.getElementById("notificationBadge");if(!badge||!data?.getNotificationCount)return;try{const result=await data.getNotificationCount();const count=Number(result.unread_count||0);badge.textContent=String(count);badge.hidden=count===0;}catch(error){badge.hidden=true;}}
  function initializeNotificationCreate(){const form=document.getElementById("notificationCreateForm");if(!form)return;form.addEventListener("submit",async(event)=>{event.preventDefault();if(!form.reportValidity())return;const button=form.querySelector("button[type='submit']"),feedback=document.getElementById("notificationCreateFeedback");button.disabled=true;feedback.textContent="Publicando…";try{await data.createNotification(Object.fromEntries(new FormData(form)));form.reset();feedback.textContent="Comunicado publicado.";showToast("Notificação publicada.");await pageController?.refresh?.();await refreshNotificationBadge();}catch(error){feedback.textContent=error.message||"Não foi possível publicar.";handleDataError(error,feedback.textContent);}finally{button.disabled=false;}});}

  function transactionRow(row){const cancelled=row.status==="cancelado";const originDetail=(row.origem||row.origin?.name)||"—";return `<tr><td>${formatDate(row.date)}</td><td><div class="transaction-description"><strong>${escapeHtml(row.description)}${cancelled?" · Cancelado":""}</strong><span>${escapeHtml(row.document_number||"—")}</span></div></td><td>${escapeHtml(originDetail)}</td><td><span class="amount income">${row.type==="entrada"&&!cancelled?formatCurrency(row.amount):"—"}</span></td><td><span class="amount expense">${row.type==="saida"&&!cancelled?formatCurrency(row.amount):"—"}</span></td><td><span class="amount">${formatCurrency(Number(row.balance_after||0))}</span></td><td class="transaction-actions-cell"><button class="button button-ghost transaction-delete" type="button" data-delete-transaction="${escapeHtml(row.id)}" aria-label="Excluir lançamento: ${escapeHtml(row.description)}" title="Excluir lançamento"><i data-lucide="trash-2" aria-hidden="true"></i><span>Excluir</span></button></td></tr>`;}
  function notificationItem(item){const link=item.link?`<a class="button button-secondary button-compact" href="${escapeHtml(item.link)}">Abrir <i data-lucide="arrow-up-right"></i></a>`:"";return `<article class="notification-item${item.read?"":" unread"}"><div class="notification-icon"><i data-lucide="${item.read?"mail-open":"mail"}"></i></div><div class="notification-content"><div class="notification-meta"><strong>${escapeHtml(item.title)}</strong><time datetime="${escapeHtml(item.published_at)}">${formatDateTime(item.published_at)}</time></div><p>${escapeHtml(item.message)}</p><div class="notification-actions">${link}<button class="button button-ghost button-compact" type="button" data-notification-read="${escapeHtml(item.id)}" data-read="${item.read?"false":"true"}">${item.read?"Marcar como não lida":"Marcar como lida"}</button></div></div></article>`;}

  function chartColor(token){return getComputedStyle(document.documentElement).getPropertyValue(token).trim();}
  function renderCashflowChart(series,id="analysisChart",visual="line"){
    const colors=[chartColor("--ui-success"),chartColor("--ui-error")];
    if(visual==="pie"){
      const data=[{name:"Entradas",value:series.income.reduce((sum,value)=>sum+Number(value||0),0)},{name:"Saídas",value:series.expense.reduce((sum,value)=>sum+Number(value||0),0)}];
      setChartOption(id,{color:colors,tooltip:{trigger:"item",valueFormatter:(value)=>formatCurrency(value)},legend:{bottom:4,left:"center",textStyle:chartTextStyle()},series:[{name:"Movimentação",type:"pie",radius:["42%","70%"],center:["50%","44%"],padAngle:2,itemStyle:{borderRadius:6},label:{formatter:"{b}\n{d}%"},data}]});return;
    }
    if(visual==="bar"){
      setChartOption(id,{color:colors,tooltip:{trigger:"axis",axisPointer:{type:"shadow"},valueFormatter:(value)=>formatCurrency(value)},legend:{top:8,right:12,textStyle:chartTextStyle()},grid:{top:54,left:20,right:24,bottom:28,containLabel:true},xAxis:chartValueAxis(),yAxis:chartCategoryAxis(series.labels),series:[{name:"Entradas",type:"bar",barLayout:"horizontal",data:series.income},{name:"Saídas",type:"bar",barLayout:"horizontal",data:series.expense}]});return;
    }
    const type=visual==="histogram"?"bar":"line";
    setChartOption(id,{color:colors,tooltip:{trigger:"axis",axisPointer:{type:visual==="histogram"?"shadow":"line"},valueFormatter:(value)=>formatCurrency(value)},legend:{top:8,right:12,textStyle:chartTextStyle()},grid:{top:54,left:20,right:20,bottom:28,containLabel:true},xAxis:chartCategoryAxis(series.labels),yAxis:chartValueAxis(),series:[{name:"Entradas",type,barCategoryGap:"8%",barGap:"0%",smooth:.3,symbol:"circle",symbolSize:6,lineStyle:{width:3},data:series.income},{name:"Saídas",type,barCategoryGap:"8%",barGap:"0%",smooth:.3,symbol:"circle",symbolSize:6,lineStyle:{width:3},data:series.expense}]});
  }
  function renderBalanceChart(series, id = "balanceChart") {
    setChartOption(id, {
      color: [chartColor("--ui-primary")],
      tooltip: { trigger: "axis", valueFormatter: (value) => formatCurrency(value) },
      legend: { top: 8, left: "center", textStyle: chartTextStyle() },
      grid: { top: 58, left: 20, right: 22, bottom: 28, containLabel: true },
      xAxis: chartCategoryAxis(series.labels),
      yAxis: chartValueAxis(),
      series: [
        { name: "Saldo acumulado", type: "line", smooth: .32, symbol: "circle", symbolSize: 7, lineStyle: { width: 4 }, areaStyle: { opacity: .08 }, emphasis: { focus: "series" }, data: series.balance },
      ]
    });
  }
  function renderCategoryChart(categories,id="analysisChart"){setChartOption(id,{tooltip:{trigger:"item",formatter:(item)=>`${escapeHtml(item.name)}<br><strong>${formatCurrency(item.value)}</strong>`},legend:{bottom:4,left:"center",textStyle:chartTextStyle()},graphic:categories.length?[]:[{type:"text",left:"center",top:"middle",style:{text:"Sem despesas no período",fill:"#64748b",fontSize:16}}],series:[{type:"pie",radius:["46%","70%"],center:["50%","44%"],padAngle:2,itemStyle:{borderRadius:5},label:{show:false},data:categories.map((item)=>({value:item.value,name:item.name,itemStyle:{color:item.color}}))}]});}
  function renderComparisonChart(comparison,id="analysisChart"){setChartOption(id,{color:[chartColor("--ui-primary-soft"),chartColor("--ui-primary")],tooltip:{trigger:"axis",axisPointer:{type:"shadow"},valueFormatter:(value)=>formatCurrency(value)},legend:{top:8,right:12,textStyle:chartTextStyle()},grid:{top:50,left:20,right:20,bottom:28,containLabel:true},xAxis:chartCategoryAxis(comparison.labels),yAxis:chartValueAxis(),series:[{name:String(comparison.previousYear),type:"bar",barMaxWidth:24,data:comparison.previous,itemStyle:{borderRadius:[5,5,0,0]}},{name:String(comparison.currentYear),type:"bar",barMaxWidth:24,data:comparison.current,itemStyle:{borderRadius:[5,5,0,0]}}]});}
  function setChartOption(id, option) {
    const element = document.getElementById(id);
    if (!element) return;
    if (!global.echarts) { element.innerHTML = '<div class="chart-fallback">A biblioteca de gráficos não foi carregada.</div>'; return; }
    const chart = charts.get(id) || global.echarts.init(element);
    charts.set(id, chart);
    const reducedMotion = global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const series = option.series.map((item) => ({
      ...item,
      ...(item.type === "line" ? { smooth: false, showSymbol: item.data.length === 1, lineStyle: { width: 3 }, emphasis: { focus: "series" } } : {}),
      ...(item.type === "bar" ? { barMaxWidth: 20, itemStyle: { ...item.itemStyle, borderRadius: item.barLayout === "horizontal" ? [0, 6, 6, 0] : [6, 6, 0, 0] } } : {}),
    }));
    const baseOption = {
      ...option,
      textStyle: chartTextStyle(),
      animation: !reducedMotion,
      animationDuration: 300,
      animationDurationUpdate: 200,
      tooltip: {
        ...option.tooltip,
        confine: true,
        backgroundColor: chartColor("--md-sys-color-surface-container-lowest"),
        borderColor: chartColor("--ui-border"),
        borderWidth: 1,
        padding: [12, 16],
        textStyle: chartTextStyle(),
        extraCssText: "border-radius:12px;box-shadow:0 4px 16px #19212d1a;",
        axisPointer: { type: "line", lineStyle: { color: chartColor("--ui-border-hover"), type: "dashed" }, ...option.tooltip?.axisPointer },
      },
      ...(option.legend ? { legend: { ...option.legend, type: "scroll", itemWidth: 14, itemHeight: 10, itemGap: 20, textStyle: chartTextStyle() } } : {}),
      series,
    };
    const months = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const shortMonth = (label) => {
      const index = months.findIndex((month) => month.slice(0, 3).toLowerCase() === String(label).slice(0, 3).toLowerCase());
      return index < 0 || /\/\d{4}$/.test(String(label)) ? label : months[index].slice(0, 3);
    };
    chart.setOption({
      baseOption,
      media: option.xAxis?.type === "category" ? [
        { query: { maxWidth: 600 }, option: {
          yAxis: { axisLabel: { show: true, fontSize: 11 } },
          xAxis: { axisLabel: { formatter: shortMonth, interval: id === "balanceChart" ? 0 : "auto", showMinLabel: true, showMaxLabel: true, hideOverlap: id !== "balanceChart", rotate: id === "balanceChart" ? 40 : 0, fontSize: id === "balanceChart" ? 11 : 12, margin: 14 } },
          grid: { left: 12, right: 16, bottom: 32, containLabel: true },
        } },
        { option: {
          yAxis: { axisLabel: { show: true } },
          xAxis: { axisLabel: { formatter: "{value}", interval: id === "balanceChart" ? 0 : "auto", showMinLabel: true, showMaxLabel: true, hideOverlap: true, rotate: 0, fontSize: 14, margin: 8 } },
          grid: option.grid,
        } },
      ] : option.yAxis?.type === "category" ? [
        { query: { maxWidth: 600 }, option: {
          yAxis: { axisLabel: { show: true, formatter: shortMonth, fontSize: 12 } },
          xAxis: { axisLabel: { formatter: option.xAxis.axisLabel.formatter, hideOverlap: true, fontSize: 11 } },
          grid: { left: 12, right: 16, bottom: 24, containLabel: true },
        } },
        { option: { xAxis: option.xAxis, yAxis: option.yAxis, grid: option.grid } },
      ] : [],
    }, true);
  }
  function chartTextStyle(){return{color:chartColor("--ui-text-muted"),fontFamily:"Roboto, sans-serif",fontSize:14};}
  function chartCategoryAxis(labels){return{type:"category",data:labels,axisLine:{lineStyle:{color:chartColor("--ui-border")}},axisTick:{show:false},axisLabel:{...chartTextStyle(),hideOverlap:true}};}
  function chartValueAxis(){return{type:"value",axisLine:{show:false},axisTick:{show:false},axisLabel:{...chartTextStyle(),formatter:(value)=>`R$ ${compactNumber(value)}`},splitLine:{lineStyle:{color:chartColor("--md-sys-color-surface-container")}}};}
  function initializeChartResize(){const resize=()=>charts.forEach((chart)=>chart.resize());global.addEventListener("resize",resize);global.addEventListener("caixa:resize",resize);}

  function renderPagination(container,current,total){if(!container)return;if(total<=1){container.innerHTML="";return;}const start=Math.max(1,Math.min(current-2,total-4)),end=Math.min(total,start+4);const pages=[];for(let p=start;p<=end;p+=1)pages.push(p);container.innerHTML=[pageButton(current-1,'<i data-lucide="chevron-left" aria-hidden="true"></i>',current===1,"Página anterior"),...pages.map((p)=>pageButton(p,String(p),false,`Página ${p}`,p===current)),pageButton(current+1,'<i data-lucide="chevron-right" aria-hidden="true"></i>',current===total,"Próxima página")].join("");}
  function pageButton(page,content,disabled,label,active=false){return `<button class="page-button${active?" active":""}" type="button" data-page="${page}" aria-label="${label}" ${disabled?"disabled":""}>${content}</button>`;}
  function setPageBusy(busy){const shell=document.querySelector(".page-shell");shell?.setAttribute("aria-busy",String(busy));shell?.classList.toggle("is-loading",busy);}
  function handleDataError(error,message="Não foi possível carregar os dados."){console.error(error);showToast(message||error.message,"error");}
  function showToast(message,type="success"){let toast=document.querySelector(".toast");if(!toast){toast=document.createElement("div");toast.className="toast";toast.setAttribute("role","status");toast.setAttribute("aria-live","polite");toast.innerHTML='<i data-lucide="circle-check"></i><span></span>';document.body.appendChild(toast);}toast.classList.toggle("toast-error",type==="error");toast.querySelector("span").textContent=message;toast.classList.add("show");refreshIcons();global.clearTimeout(global.__caixaToast);global.__caixaToast=global.setTimeout(()=>toast.classList.remove("show"),3500);}
  function emptyTableRow(columns,message,isError=false){return `<tr><td colspan="${columns}"><div class="table-empty${isError?" error":""}"><span>${escapeHtml(message)}</span></div></td></tr>`;}
  function setText(selector,value){const el=document.querySelector(selector);if(el)el.textContent=value;}
  function formatCurrency(value,digits=2){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value||0));}
  function formatPercent(value){return new Intl.NumberFormat("pt-BR",{style:"percent",minimumFractionDigits:1,maximumFractionDigits:1}).format(Number(value||0)/100);}
  function compactNumber(value){return new Intl.NumberFormat("pt-BR",{notation:"compact",maximumFractionDigits:1}).format(Number(value||0));}
  function formatDate(value){if(!value)return"—";const [y,m,d]=String(value).slice(0,10).split("-");return y&&m&&d?`${d}/${m}/${y}`:String(value);}
  function formatDateTime(value){if(!value)return"—";const date=new Date(value);return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(date);}
  function formatMoneyInput(value){return new Intl.NumberFormat("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0));}
  function parseCurrencyInput(value){const normalized=String(value||"").trim().replace(/\s/g,"").replace(/R\$/g,"").replace(/\./g,"").replace(",",".");return Number(normalized);}
  function localIsoDate(){return new Date().toLocaleDateString("sv-SE");}
  function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);}
})(window);
