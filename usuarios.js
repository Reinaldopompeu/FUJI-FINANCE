(() => {
  "use strict";
  const modal = document.getElementById("userModal");
  const form = document.getElementById("userForm");
  const list = document.getElementById("userList");
  const total = document.getElementById("totalUsers");
  const feedback = document.getElementById("userFeedback");
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || "";
  if (!modal || !form) return;

  function icons() { if (window.lucide) window.lucide.createIcons(); }
  function escape(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
  function open() { form.reset(); feedback.textContent = ""; modal.classList.add("open"); modal.setAttribute("aria-hidden", "false"); document.body.classList.add("modal-open"); setTimeout(() => document.getElementById("userName")?.focus(), 30); }
  function close() { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); document.body.classList.remove("modal-open"); document.getElementById("openUserModal")?.focus(); }

  async function load() {
    try {
      const response = await fetch("/api/usuarios", { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.erro || "Não foi possível carregar usuários.");
      total.textContent = `${data.usuarios.length} ${data.usuarios.length === 1 ? "usuário" : "usuários"}`;
      list.innerHTML = data.usuarios.map((user) => `
        <article class="user-card">
          <div class="user-avatar">${escape(user.nome.slice(0, 2).toUpperCase())}</div>
          <div class="user-copy"><strong>${escape(user.nome)}</strong><span>${escape(user.email)}</span></div>
          <span class="user-login">@${escape(user.usuario)}</span>
          <span class="status ${user.administrador ? "paid" : "pending"}">${user.administrador ? "Administrador" : "Usuário"}</span>
        </article>`).join("");
    } catch (error) {
      list.innerHTML = `<div class="table-empty is-error"><span>${escape(error.message)}</span></div>`;
    }
  }

  document.getElementById("openUserModal")?.addEventListener("click", open);
  document.addEventListener("click", (event) => { if (event.target.closest("[data-close-user-modal]")) close(); });
  modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && modal.classList.contains("open")) close(); });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector("button[type='submit']");
    const payload = Object.fromEntries(new FormData(form));
    payload.administrador = form.elements.administrador.checked;
    button.disabled = true;
    feedback.textContent = "Salvando usuário…";
    try {
      const response = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.erro || "Não foi possível criar o usuário.");
      close();
      await load();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  load().then(icons);
})();
