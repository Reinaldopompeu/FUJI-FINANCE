(function (global) {
  "use strict";
  async function download(report, source) {
    const generator = global.CaixaLivroPdf;
    if (!generator) throw new Error("O gerador de relatórios não foi carregado.");
    const year = report.period.slice(0, 4);
    const monthly = report.period.length === 7;
    const start = monthly ? report.period + "-01" : year + "-01-01";
    const end = monthly
      ? new Date(Date.UTC(Number(year), Number(report.period.slice(5, 7)), 0)).toISOString().slice(0, 10)
      : year + "-12-31";
    const company = { ...source.company, razaoSocial: source.company.company, cnpj: source.company.document };
    const book = generator.buildBook(source.transactions, source.banks, year, { start, end });
    if (report.type === "banco") {
      const bank = source.banks.find((item) => item.id === report.filters.bank_id);
      if (!bank) throw new Error("Banco não encontrado.");
      const label = bank.name.toUpperCase();
      const category = "DISPONÍVEL";
      book.sections = book.sections.filter((s) => s.categoriaLabel === category && s.subcategoriaLabel === label);
      book.rows = book.rows.filter((r) => r.categoriaLabel === category && r.subcategoriaLabel === label);
    }
    const filename = report.type + "-" + report.period;
    if (report.format === "PDF") {
      generator.download(generator.generate(book, year, company, {
        title: report.name, period: report.period, terms: report.type === "livro",
      }), filename + ".pdf");
      return;
    }
    const rows = [["Categoria", "Conta / grupo", "Data", "Documento", "Histórico", "Entrada", "Saída", "Saldo"]];
    const currency = (value) => Number(value).toFixed(2).replace(".", ",");
    const sections = new Map();
    [...book.sections, ...book.rows].forEach((s) => sections.set([s.categoriaCode,s.categoriaLabel,s.subcategoriaCode,s.subcategoriaLabel].join("|"), s));
    sections.forEach((section, key) => {
      let balance = book.openings.get(key) || 0;
      rows.push([section.categoriaLabel,section.subcategoriaLabel,start,"","Saldo anterior","","",currency(balance)]);
      book.rows.filter((r) => [r.categoriaCode,r.categoriaLabel,r.subcategoriaCode,r.subcategoriaLabel].join("|") === key)
        .sort((a,b) => a.data.localeCompare(b.data) || String(a.id).localeCompare(String(b.id), "pt-BR", {numeric:true}))
        .forEach((r) => {
          balance = Math.round((balance + r.signedValue) * 100) / 100;
          rows.push([r.categoriaLabel,r.subcategoriaLabel,r.data,r.numero,r.historico,r.signedValue > 0 ? currency(r.signedValue) : "",r.signedValue < 0 ? currency(-r.signedValue) : "",currency(balance)]);
        });
    });
    const csv = "\ufeff" + rows.map((row) => row.map((value) => {
      let text = String(value ?? "");
      if (/^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    }).join(";")).join("\r\n");
    generator.download(new Blob([csv], {type:"text/csv;charset=utf-8"}), filename + ".csv");
  }
  global.CaixaReportExport = { download };
})(window);
