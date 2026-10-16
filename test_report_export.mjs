import assert from "node:assert/strict";
import fs from "node:fs/promises";
import "../static/js/livro-caixa-pdf.js";
globalThis.window = globalThis;
await import("../static/js/report-export.js");
const banks = [
  {id:"inter",name:"Banco Inter",bank_category:"Disponível",initial_balance:1000},
  {id:"bb",name:"Banco do Brasil",bank_category:"Indisponível",initial_balance:200},
];
const tx = [
  {id:1,date:"2025-12-01",type:"entrada",amount:100,origem:"Vendas",destino:"Banco Inter",description:"Saldo anterior"},
  {id:2,date:"2026-01-05",type:"entrada",amount:500,origem:"Vendas",destino:"Banco Inter",description:"Recebimento de serviços",subcategory:{name:"Serviços"}},
  {id:3,date:"2026-01-06",type:"transferencia",amount:50,origem:"Banco Inter",destino:"Banco do Brasil",description:"Transferência bancária"},
  {id:4,date:"2026-01-07",type:"saida",amount:30,origem:"Banco Inter",destino:"Despesas",description:"Pagamento",subcategory:{name:"Energia"}},
  {id:5,date:"2026-01-08",type:"saida",amount:999,origem:"Banco Inter",destino:"Despesas",description:"Não contabilizar",status:"cancelado"},
];
const book = CaixaLivroPdf.buildBook(tx,banks,"2026");
assert.equal([...book.openings.values()].reduce((a,b)=>a+b,0),1300);
assert.equal(book.rows.some((r)=>r.id===5),false);
assert.equal(book.rows.filter((r)=>r.id===3).reduce((a,r)=>a+r.signedValue,0),0);
assert.equal(book.sections[1].categoriaLabel,"DISPONÍVEL");
const feb = CaixaLivroPdf.buildBook(tx,banks,"2026",{start:"2026-02-01",end:"2026-02-28"});
assert.equal(feb.rows.length,0);
assert.equal([...feb.openings.values()].reduce((a,b)=>a+b,0),1770);
const source={transactions:tx,banks,company:{company:"Empresa de Exemplo",nomeFantasia:"Loja Exemplo",document:"12.345.678/0001-90",endereco:"Rua das Flores",numero:"100",municipio:"Belém",estado:"PA",inscricaoMunicipal:"12345",inscricaoEstadual:"67890"}};
const output = [];
CaixaLivroPdf.download = (blob,name) => output.push({blob,name});
for(const type of ["livro","fluxo","banco"]) {
  await CaixaReportExport.download({type,name:{livro:"Livro Caixa",fluxo:"Fluxo de Caixa",banco:"Movimentação Bancária"}[type],period:type==="livro"?"2026":"2026-01",format:"PDF",filters:{bank_id:"inter"}},source);
}
for(const {blob,name} of output) {
  assert.equal(blob.type,"application/pdf");
  assert.ok((await blob.text()).startsWith("%PDF-1.4"));
  if(process.env.REPORT_QA_DIR) {
    await fs.mkdir(process.env.REPORT_QA_DIR,{recursive:true});
    await fs.writeFile(process.env.REPORT_QA_DIR+"/"+name,new Uint8Array(await blob.arrayBuffer()));
  }
}
await CaixaReportExport.download({type:"banco",name:"Bancos",period:"2026-01",format:"CSV",filters:{bank_id:"inter"}},source);
const csv=await output.at(-1).blob.text();
assert.ok(csv.includes("1520,00"));
assert.ok(!csv.includes("BANCO DO BRASIL"));
assert.ok(!csv.includes("Não contabilizar"));
console.log("OK: aberturas, transferências, cancelamentos, categorias e downloads PDF/CSV.");
