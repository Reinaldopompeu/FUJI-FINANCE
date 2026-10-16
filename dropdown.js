(function initializeDropdown(global) {
  "use strict";

  const instances = new WeakMap();
  let openInstance = null;

  class Dropdown {
    constructor(select) {
      if (!select || instances.has(select)) return instances.get(select);

      this.select = select;
      this.root = document.createElement("div");
      this.root.className = "dropdown";
      this.root.dataset.dropdown = "";

      this.trigger = document.createElement("button");
      this.trigger.type = "button";
      this.trigger.className = "dropdown-trigger";
      this.trigger.setAttribute("aria-haspopup", "listbox");
      this.trigger.setAttribute("aria-expanded", "false");

      this.filterShell = select.closest(".filter-select");
      this.leadingIcon = this.filterShell
        ? [...this.filterShell.children].find((child) => child.matches("i[data-lucide], svg[data-lucide]"))
        : null;
      if (this.leadingIcon) {
        this.leadingIcon.classList.add("dropdown-leading-icon");
        this.trigger.append(this.leadingIcon);
      }

      this.valueLabel = document.createElement("span");
      this.valueLabel.className = "dropdown-value";
      this.trigger.append(this.valueLabel);

      this.chevron = document.createElement("i");
      this.chevron.className = "dropdown-chevron";
      this.chevron.dataset.lucide = "chevron-down";
      this.chevron.setAttribute("aria-hidden", "true");
      this.trigger.append(this.chevron);

      this.menu = document.createElement("div");
      this.menu.className = "dropdown-menu";
      this.menu.hidden = true;
      this.menu.setAttribute("role", "listbox");

      const uid = select.id || `dropdown-${Math.random().toString(36).slice(2, 9)}`;
      this.menu.id = `${uid}-dropdown-menu`;
      this.trigger.setAttribute("aria-controls", this.menu.id);
      this.trigger.setAttribute("aria-label", select.getAttribute("aria-label") || this.labelText() || "Selecionar opção");

      select.classList.add("dropdown-native");
      select.setAttribute("aria-hidden", "true");
      select.tabIndex = -1;
      select.insertAdjacentElement("afterend", this.root);
      this.root.append(this.trigger);
      document.body.append(this.menu);

      this.bind();
      this.sync();
      this.observe();
      instances.set(select, this);
    }

    labelText() {
      if (!this.select.id) return "";
      const label = document.querySelector(`label[for="${CSS.escape(this.select.id)}"]`);
      return label?.textContent?.replace("*", "").trim() || "";
    }

    bind() {
      this.trigger.addEventListener("click", (event) => {
        event.preventDefault();
        this.toggle();
      });

      this.trigger.addEventListener("keydown", (event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!this.isOpen()) this.open();
          const options = this.enabledOptions();
          if (!options.length) return;
          const active = this.menu.querySelector(".dropdown-option.is-active");
          let index = Math.max(0, options.indexOf(active));
          if (event.key === "ArrowDown") index = Math.min(options.length - 1, index + (active ? 1 : 0));
          if (event.key === "ArrowUp") index = Math.max(0, index - 1);
          if (event.key === "Home") index = 0;
          if (event.key === "End") index = options.length - 1;
          options[index]?.focus();
        }
      });

      this.menu.addEventListener("keydown", (event) => {
        const options = this.enabledOptions();
        const index = options.indexOf(document.activeElement);
        if (event.key === "Escape") {
          event.preventDefault();
          this.close(true);
          return;
        }
        if (event.key === "Tab") {
          this.close();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === "ArrowDown") next = Math.min(options.length - 1, index + 1);
        if (event.key === "ArrowUp") next = Math.max(0, index - 1);
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = options.length - 1;
        options[next]?.focus();
      });

      this.select.addEventListener("change", () => this.sync());
      this.select.addEventListener("input", () => this.sync());
      this.select.form?.addEventListener("reset", () => global.setTimeout(() => this.sync()));

      if (this.select.id) {
        document.querySelectorAll(`label[for="${CSS.escape(this.select.id)}"]`).forEach((label) => {
          label.addEventListener("click", (event) => {
            if (event.target.closest("button, a, input")) return;
            event.preventDefault();
            this.trigger.focus();
          });
        });
      }
    }

    observe() {
      // A largura pode mudar depois do resize, durante a transição da sidebar.
      this.resizeObserver = new ResizeObserver(() => {
        if (this.isOpen()) this.position();
      });
      this.resizeObserver.observe(this.filterShell || this.root);
      this.observer = new MutationObserver(() => this.sync());
      this.observer.observe(this.select, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled", "selected", "label"],
      });
    }

    renderOptions() {
      const selected = this.select.value;
      this.menu.innerHTML = "";
      [...this.select.options].forEach((option, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "dropdown-option";
        item.setAttribute("role", "option");
        item.dataset.value = option.value;
        item.textContent = option.textContent;
        item.disabled = option.disabled;
        item.setAttribute("aria-selected", String(option.value === selected));
        item.classList.toggle("is-active", option.value === selected);
        item.addEventListener("click", () => this.choose(index));
        this.menu.append(item);
      });
    }

    choose(index) {
      const option = this.select.options[index];
      if (!option || option.disabled) return;
      const changed = this.select.value !== option.value;
      this.select.value = option.value;
      this.sync();
      this.close(true);
      if (changed) {
        this.select.dispatchEvent(new Event("input", { bubbles: true }));
        this.select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    sync() {
      const selected = this.select.selectedOptions?.[0];
      const fallback = this.select.options?.[0];
      this.valueLabel.textContent = selected?.textContent || fallback?.textContent || "Selecione";
      this.root.classList.toggle("is-placeholder", !this.select.value);
      this.trigger.disabled = this.select.disabled;
      this.trigger.setAttribute("aria-disabled", String(this.select.disabled));
      this.renderOptions();
      if (this.isOpen()) this.position();
    }

    enabledOptions() {
      return [...this.menu.querySelectorAll(".dropdown-option:not(:disabled)")];
    }

    isOpen() {
      return openInstance === this && !this.menu.hidden;
    }

    toggle() {
      this.isOpen() ? this.close() : this.open();
    }

    open() {
      if (this.select.disabled) return;
      if (openInstance && openInstance !== this) openInstance.close();
      openInstance = this;
      this.renderOptions();
      this.menu.hidden = false;
      this.root.classList.add("is-open");
      this.trigger.setAttribute("aria-expanded", "true");
      this.position();
    }

    close(restoreFocus = false) {
      if (!this.isOpen() && this.menu.hidden) return;
      this.menu.hidden = true;
      this.root.classList.remove("is-open");
      this.trigger.setAttribute("aria-expanded", "false");
      if (openInstance === this) openInstance = null;
      if (restoreFocus) this.trigger.focus();
    }

    position() {
      if (this.menu.hidden) return;
      const rect = (this.filterShell || this.root).getBoundingClientRect();
      const gap = 6;
      const viewportGap = 8;
      const viewportWidth = Math.max(0, global.innerWidth - viewportGap * 2);
      const iconFilter = this.filterShell && global.matchMedia("(max-width: 768px)").matches;
      const desiredWidth = Math.min(viewportWidth, iconFilter ? Math.max(240, rect.width) : rect.width);
      this.menu.style.width = `${desiredWidth}px`;
      this.menu.style.minWidth = "0";
      this.menu.style.maxWidth = `${viewportWidth}px`;

      const measuredHeight = Math.min(this.menu.scrollHeight, 320);
      const below = global.innerHeight - rect.bottom - viewportGap;
      const above = rect.top - viewportGap;
      const openUp = below < Math.min(measuredHeight, 180) && above > below;
      const available = Math.max(0, openUp ? above - gap : below - gap);
      const centeredLeft = rect.left + (rect.width - desiredWidth) / 2;
      const left = Math.min(
        Math.max(viewportGap, centeredLeft),
        Math.max(viewportGap, global.innerWidth - desiredWidth - viewportGap),
      );

      this.menu.style.maxHeight = `${Math.min(320, available)}px`;
      this.menu.style.left = `${left}px`;
      this.menu.style.top = openUp
        ? `${Math.max(viewportGap, rect.top - Math.min(measuredHeight, available) - gap)}px`
        : `${Math.min(global.innerHeight - viewportGap, rect.bottom + gap)}px`;
    }
  }

  function enhance(root = document) {
    root.querySelectorAll("select:not(.dropdown-native)").forEach((select) => new Dropdown(select));
  }

  document.addEventListener("DOMContentLoaded", () => enhance());
  document.addEventListener("click", (event) => {
    if (!openInstance) return;
    if (openInstance.root.contains(event.target) || openInstance.menu.contains(event.target)) return;
    openInstance.close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openInstance) openInstance.close(true);
  });
  global.addEventListener("resize", () => openInstance?.position());
  document.addEventListener("scroll", () => openInstance?.position(), true);

  global.Dropdown = { enhance, get: (select) => instances.get(select) || null };
})(window);
