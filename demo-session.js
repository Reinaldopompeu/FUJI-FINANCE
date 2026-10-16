/* Demonstração temporária: navegar preserva; recarregar reinicia. */
(function (global) {
  if (document.body.dataset.demo !== "true") return;
  if (global.performance?.getEntriesByType("navigation")[0]?.type === "reload") {
    global.sessionStorage.removeItem("caixa-facil.demo.session.v1");
    global.sessionStorage.removeItem("caixa-facil.tutorial.sandbox.v1");
  }
})(window);
