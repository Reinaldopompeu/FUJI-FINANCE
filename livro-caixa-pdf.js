/* Modelo adaptado de fujiBookPdfBlob, projeto de teste Pinguim financeiro. */
(function(global) {
"use strict";
const money = new Intl.NumberFormat("pt-BR", {style:"currency", currency:"BRL"});
const fmtDate = value => String(value).slice(0,10).split("-").reverse().join("/");
    function fujiPdfBytesFromString(value) {
      return Uint8Array.from(Array.from(value).map(char => {
        const code = char.charCodeAt(0);
        return code <= 255 ? code : 63;
      }));
    }

    function fujiPdfText(value) {
      return String(value ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    }

    function fujiDownloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.target = '_blank';
      link.rel = 'noopener';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
      }, 30000);
    }

    function fujiLabelParts(value, fallbackCode, fallbackLabel) {
      const text = String(value || '').trim();
      const match = text.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
      return match
        ? { code: match[1], label: match[2].toUpperCase() }
        : { code: fallbackCode, label: String(text || fallbackLabel || 'SEM CATEGORIA').toUpperCase() };
    }

    function fujiRowsFromBook(book) { return book; }

    function fujiBookPdfBlob(book, year, company, options = {}) {
      const { rows, openings } = fujiRowsFromBook(book);
      const monthNames = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
      const printedDate = new Date().toLocaleDateString('pt-BR');
      const reportTitle = options.title || 'LIVRO CAIXA';
      const companyName = company.razaoSocial || company.nomeFantasia || 'EMPRESA NÃO INFORMADA';
      const pageWidth = 595;
      const pageHeight = 842;
      const marginX = 10;
      const tableWidth = 575;
      const x = marginX;
      const widths = [15, 58, 84, 220, 66, 66, 66];
      const pages = [[]];
      let page = pages[0];
      const pageTop = 814;
      const pageBottom = 38;
      let y = pageTop;
      const add = command => page.push(command);
      const font = (bold = false, size = 9) => `${bold ? '/F2' : '/F1'} ${size} Tf`;
      const rect = (rx, ry, rw, rh, fill = '') => {
        if (fill) add(`${fill} rg ${rx} ${ry} ${rw} ${rh} re f 0 0 0 rg`);
        add(`0 0 0 rg 0.7 w ${rx} ${ry} ${rw} ${rh} re S`);
      };
      const timesWidth = { ' ': 250, ',': 250, '.': 250, '-': 333, '/': 278, ':': 278, '0': 500, '1': 500, '2': 500, '3': 500, '4': 500, '5': 500, '6': 500, '7': 500, '8': 500, '9': 500, A: 722, B: 667, C: 667, D: 722, E: 611, F: 556, G: 722, H: 722, I: 333, J: 389, K: 722, L: 611, M: 889, N: 722, O: 722, P: 556, Q: 722, R: 667, S: 556, T: 611, U: 722, V: 722, W: 944, X: 722, Y: 722, Z: 611, '°': 400, 'º': 400, a: 444, b: 500, c: 444, d: 500, e: 444, f: 333, g: 500, h: 500, i: 278, j: 278, k: 500, l: 278, m: 778, n: 500, o: 500, p: 500, q: 500, r: 333, s: 389, t: 278, u: 500, v: 500, w: 722, x: 500, y: 500, z: 444 };
      const baseChar = char => char.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace('Ç', 'C').replace('ç', 'c');
      const textWidth = (value, size) => String(value ?? '').split('').reduce((sum, char) => sum + (((timesWidth[char] ? timesWidth[char] : timesWidth[baseChar(char)]) || 500) * size) / 1000, 0);
      const text = (value, tx, ty, { bold = false, size = 9, align = 'left', width = 0 } = {}) => {
        let actualSize = size;
        while (width && textWidth(value, actualSize) > width - 4 && actualSize > 6) actualSize -= .5;
        let px = tx;
        if (align === 'center') px = tx + Math.max(0, (width - textWidth(value, actualSize)) / 2);
        if (align === 'right') px = tx + width - textWidth(value, actualSize) - 4;
        add(`BT ${font(bold, actualSize)} 0 Tw ${px.toFixed(2)} ${ty.toFixed(2)} Td (${fujiPdfText(value)}) Tj ET`);
      };
      const drawHeader = () => {
        text(String(companyName).toUpperCase(), x, y - 2, { bold: true, size: 12, align: 'center', width: tableWidth });
        y -= 18;
        text(`${reportTitle} - ${options.period || year}`, x, y - 2, { size: 9, align: "center", width: tableWidth });
        y -= 20;
      };
      const newPage = () => {
        page = [];
        pages.push(page);
        y = pageTop;
        drawHeader();
      };
      const ensure = height => {
        if (y - height < pageBottom) {
          newPage();
          return true;
        }
        return false;
      };
      const wrap = (value, width = 210, size = 8) => {
        const words = String(value || '').split(/\s+/).filter(Boolean);
        const lines = [];
        let current = '';
        words.forEach(word => {
          const candidate = current ? `${current} ${word}` : word;
          if (current && textWidth(candidate, size) > width) {
            lines.push(current);
            current = word;
          } else {
            current = candidate;
          }
        });
        if (current) lines.push(current);
        return lines.length ? lines : [''];
      };
      const cell = (value, cx, cy, cw, ch, opts = {}) => {
        rect(cx, cy - ch, cw, ch, opts.fill || '');
        text(value, cx + 4, cy - ch + Math.max(4, (ch - (opts.size || 9)) / 2 + 1), { size: opts.size || 9, bold: opts.bold, align: opts.align || 'left', width: cw - 8 });
      };
      const multiCell = (lines, cx, cy, cw, ch, opts = {}) => {
        rect(cx, cy - ch, cw, ch, opts.fill || '');
        const size = opts.size || 8;
        const lineHeight = opts.lineHeight || 10;
        const first = cy - ((ch - (lines.length * lineHeight)) / 2) - size;
        lines.forEach((line, idx) => text(line, cx + 4, first - (idx * lineHeight), { size, bold: opts.bold, align: opts.align || 'left', width: cw - 8 }));
      };
      const entrada = value => Math.max(value, 0);
      const saida = value => Math.abs(Math.min(value, 0));
      const formatEntrada = value => value > 0 ? money.format(value) : '-';
      const formatSaida = value => value > 0 ? money.format(value) : '-';
      const formatSaldo = value => money.format(value);
      const saldoFill = value => value < 0 ? '0.96 0.78 0.78' : '0.851 0.918 0.827';
      const dateLabel = value => fmtDate(value);
      const groups = new Map();
      rows.forEach(row => {
        const categoryKey = `${row.categoriaCode}|${row.categoriaLabel}`;
        const subKey = `${row.subcategoriaCode}|${row.subcategoriaLabel}`;
        if (!groups.has(categoryKey)) groups.set(categoryKey, new Map());
        const subgroups = groups.get(categoryKey);
        if (!subgroups.has(subKey)) subgroups.set(subKey, []);
        subgroups.get(subKey).push(row);
      });
      (book.sections || []).forEach(section => {
        const key = `${section.categoriaCode}|${section.categoriaLabel}`;
        if (!groups.has(key)) groups.set(key, new Map());
        const subkey = `${section.subcategoriaCode}|${section.subcategoriaLabel}`;
        if (!groups.get(key).has(subkey)) groups.get(key).set(subkey, []);
      });
      const sameKey = row => `${row.categoriaCode}|${row.categoriaLabel}|${row.subcategoriaCode}|${row.subcategoriaLabel}`;
      const openingBalanceFor = (accountRows, key) => openings.get(accountRows.length ? sameKey(accountRows[0]) : key) || 0;
      const sortRows = items => [...items].sort((a, b) => a.data.localeCompare(b.data) || String(a.numero).localeCompare(String(b.numero), 'pt-BR', { numeric: true }) || String(a.rowId).localeCompare(String(b.rowId)));
      const previousMonthInfo = () => {
        const date = new Date(`${book.start || `${year}-01-01`}T12:00:00`);
        date.setDate(0);
        return { date: date.toLocaleDateString('pt-BR'), label: `${monthNames[date.getMonth()]}/${date.getFullYear()}` };
      };

      drawHeader();
      [...groups.entries()].sort(([a], [b]) => Number(a.split('|')[0]) - Number(b.split('|')[0])).forEach(([categoryKey, subgroups]) => {
        const [categoryCode, category] = categoryKey.split('|');
        const ordered = [...subgroups.entries()].sort(([a], [b]) => Number(a.split('|')[0]) - Number(b.split('|')[0]));
        const groupRows = ordered.flatMap(([, group]) => group);
        const categoryEntrada = groupRows.reduce((sum, row) => sum + entrada(row.signedValue), 0);
        const categorySaida = groupRows.reduce((sum, row) => sum + saida(row.signedValue), 0);
        const categorySaldo = ordered.reduce((sum, [sectionKey, sectionRows]) => {
          const sorted = sortRows(sectionRows);
          return sum + openingBalanceFor(sorted, `${categoryKey}|${sectionKey}`) + sorted.reduce((total, row) => total + row.signedValue, 0);
        }, 0);
        const indentX = x + widths[0];
        const innerWidth = tableWidth - widths[0];
        let categoryTop = null;
        const closeRail = () => {
          if (categoryTop !== null && categoryTop > y) rect(x, y, widths[0], categoryTop - y);
          categoryTop = null;
        };
        const drawCategoryHeader = (continued = false) => {
          cell(`${categoryCode}. ${category}${continued ? ' - CONTINUAÇÃO' : ''}`, x, y, tableWidth, 16, { bold: true, fill: continued ? '0.96 0.96 0.96' : '', size: 9 });
          y -= 16;
          categoryTop = y;
        };
        const drawCols = () => {
          let cx = indentX;
          ['DATA', 'NºLANÇAMENTO', 'HISTÓRICO', 'ENTRADA', 'SAÍDA', 'SALDO'].forEach((header, index) => {
            const cw = widths[index + 1];
            cell(header, cx, y, cw, 16, { bold: true, align: 'center', fill: '0.82 0.82 0.82', size: 9 });
            cx += cw;
          });
          y -= 16;
        };
        const contCat = (subCode = '', sub = '') => {
          closeRail();
          newPage();
          drawCategoryHeader(true);
          if (sub) {
            cell(`${subCode} ${sub} - CONTINUAÇÃO`, indentX, y, innerWidth, 16, { bold: true, fill: '0.96 0.96 0.96', size: 9 });
            y -= 16;
            drawCols();
          }
        };
        if (ensure(83)) drawCategoryHeader(true);
        else drawCategoryHeader(false);
        ordered.forEach(([subKey, subRows]) => {
          const [subCode, sub] = subKey.split('|');
          const sorted = sortRows(subRows);
          const ent = sorted.reduce((sum, row) => sum + entrada(row.signedValue), 0);
          const sai = sorted.reduce((sum, row) => sum + saida(row.signedValue), 0);
          let running = openingBalanceFor(sorted, `${categoryKey}|${subKey}`);
          const saldoTotal = running + ent - sai;
          if (y - 84 < pageBottom) contCat();
          cell(`${subCode} ${sub}`, indentX, y, innerWidth, 16, { bold: true, size: 9 });
          y -= 16;
          drawCols();
          let opened = false;
          sorted.forEach(row => {
            if (!opened) {
              if (y - 68 < pageBottom) contCat(subCode, sub);
              const previous = previousMonthInfo();
              let cx = indentX;
              [
                { text: previous.date, align: 'center' },
                { text: '-', align: 'center' },
                { text: `SALDO ANTERIOR - ${previous.label}`, align: 'left' },
                { text: '-', align: 'center' },
                { text: '-', align: 'center' },
                { text: formatSaldo(running), align: 'center' }
              ].forEach((item, index) => {
                const cw = widths[index + 1];
                cell(item.text, cx, y, cw, 17, { align: item.align, fill: '0.94 0.94 0.94', size: 8.5, bold: true });
                cx += cw;
              });
              y -= 17;
              opened = true;
            }
            const lines = wrap(row.historico);
            const rowHeight = Math.max(17, lines.length * 10 + 8);
            if (y - (rowHeight + 34) < pageBottom) contCat(subCode, sub);
            running += row.signedValue;
            let cx = indentX;
            [
              { text: dateLabel(row.data), align: 'center' },
              { text: row.numero, align: 'center' },
              { text: row.historico.toLowerCase(), lines: lines.map(line => line.toLowerCase()), align: 'left', size: 8 },
              { text: formatEntrada(entrada(row.signedValue)), align: 'center' },
              { text: formatSaida(saida(row.signedValue)), align: 'center' },
              { text: formatSaldo(running), align: 'center' }
            ].forEach((item, index) => {
              const cw = widths[index + 1];
              if (item.lines && item.lines.length > 1) multiCell(item.lines, cx, y, cw, rowHeight, { align: item.align, size: item.size || 8 });
              else cell(item.lines ? item.lines[0] : item.text, cx, y, cw, rowHeight, { align: item.align, size: item.size || 9 });
              cx += cw;
            });
            y -= rowHeight;
          });
          const fill = saldoFill(saldoTotal);
          cell(`TOTAL - ${sub}`, indentX, y, widths[1] + widths[2] + widths[3], 16, { fill, bold: true, size: 9 });
          cell(formatEntrada(ent), indentX + widths[1] + widths[2] + widths[3], y, widths[4], 16, { fill, bold: true, align: 'center', size: 9 });
          cell(formatSaida(sai), indentX + widths[1] + widths[2] + widths[3] + widths[4], y, widths[5], 16, { fill, bold: true, align: 'center', size: 9 });
          cell(formatSaldo(saldoTotal), indentX + widths[1] + widths[2] + widths[3] + widths[4] + widths[5], y, widths[6], 16, { fill, bold: true, align: 'center', size: 9 });
          y -= 16;
        });
        if (y - 18 < pageBottom) contCat();
        closeRail();
        const fill = saldoFill(categorySaldo);
        cell(`TOTAL - ${category}`, x, y, widths[0] + widths[1] + widths[2] + widths[3], 18, { fill, bold: true, size: 9 });
        cell(formatEntrada(categoryEntrada), x + widths[0] + widths[1] + widths[2] + widths[3], y, widths[4], 18, { fill, bold: true, align: 'center', size: 9 });
        cell(formatSaida(categorySaida), x + widths[0] + widths[1] + widths[2] + widths[3] + widths[4], y, widths[5], 18, { fill, bold: true, align: 'center', size: 9 });
        cell(formatSaldo(categorySaldo), x + widths[0] + widths[1] + widths[2] + widths[3] + widths[4] + widths[5], y, widths[6], 18, { fill, bold: true, align: 'center', size: 9 });
        y -= 26;
      });
      if (!groups.size) cell('Nenhum lançamento encontrado para o período informado.', x, y, tableWidth, 18, { bold: true, align: 'center', size: 9 });

      const bookLaunchCount = new Set(rows.map(row => row.id)).size;
      const totalBookPages = pages.length + 2;
      const wrappedText = (value, tx, ty, width, { bold = false, size = 9, lineHeight = 14, align = 'left' } = {}) => {
        const words = String(value).split(/\s+/).filter(Boolean);
        const lines = [];
        let current = '';
        words.forEach(word => {
          const candidate = current ? `${current} ${word}` : word;
          if (current && textWidth(candidate, size) > width) {
            lines.push(current);
            current = word;
          } else {
            current = candidate;
          }
        });
        if (current) lines.push(current);
        lines.forEach((line, idx) => text(line, tx, ty - idx * lineHeight, { bold, size, align, width }));
        return ty - lines.length * lineHeight;
      };
      const createTermPage = (closing = false) => {
        const savedPage = page;
        const savedY = y;
        const commands = [];
        page = commands;
        y = pageTop;
        const termX = 48;
        const termWidth = 499;
        const innerX = termX + 25;
        const innerWidth = termWidth - 50;
        const termTitle = closing ? 'TERMO DE ENCERRAMENTO' : 'TERMO DE ABERTURA';
        const pageWord = totalBookPages === 1 ? 'folha' : 'folhas';
        const launchWord = bookLaunchCount === 1 ? 'lançamento' : 'lançamentos';
        const startDate = `01/01/${year}`;
        const endDate = `31/12/${year}`;
        const termDate = closing ? endDate : startDate;
        const drawLineField = (label, value, fx, fy, fw, opt = {}) => {
          const labelSize = opt.labelSize || 9;
          const labelWidth = Math.max(18, textWidth(label, labelSize) + 2);
          text(label, fx, fy + 3, { size: labelSize, bold: !!opt.boldLabel });
          add(`0.45 w ${fx + labelWidth} ${fy} m ${fx + fw} ${fy} l S`);
          if (value && value !== '-') text(String(value), fx + labelWidth + 4, fy + 3, { size: opt.valueSize || 9, bold: !!opt.boldValue, width: Math.max(20, fw - labelWidth - 8) });
        };
        const drawSectionHeader = (label, hy) => {
          rect(innerX, hy, innerWidth, 22, '0.94 0.94 0.94');
          text(label, innerX + 9, hy + 7, { bold: true, size: 9 });
        };
        rect(termX, 64, termWidth, 716);
        text('LIVRO CAIXA', innerX, 748, { bold: true, size: 15, align: 'center', width: innerWidth });
        text(termTitle, innerX, 720, { bold: true, size: 10, align: 'center', width: innerWidth });
        add(`0.7 w ${innerX} 699 m ${innerX + innerWidth} 699 l S`);
        drawLineField(closing ? 'Data de encerramento:' : 'Data de abertura:', termDate, innerX, 661, 250, { boldValue: true });
        drawLineField('Número de Ordem:', '001', innerX + 302, 661, innerWidth - 302, { boldValue: true });
        const openingParagraph = `Contém o presente Livro Caixa ${totalBookPages} ${pageWord}, numeradas sequencialmente do número 1 ao número ${totalBookPages}, que servirá para a escrituração dos pagamentos, recebimentos, entradas e saídas financeiras do contribuinte identificado abaixo.`;
        const closingParagraph = `Contém o presente Livro Caixa ${totalBookPages} ${pageWord}, numeradas sequencialmente do número 1 ao número ${totalBookPages}, no qual foram registrados ${bookLaunchCount} ${launchWord} referentes aos pagamentos, recebimentos, entradas e saídas financeiras do contribuinte identificado abaixo.`;
        wrappedText(closing ? closingParagraph : openingParagraph, innerX, 620, innerWidth, { size: 9.5, lineHeight: 15 });
        drawLineField('Período de escrituração:', `${startDate} a ${endDate}`, innerX, 563, innerWidth, { boldValue: true });
        drawSectionHeader('IDENTIFICAÇÃO DO CONTRIBUINTE/ENTIDADE', 523);
        drawLineField('Nome/Razão Social:', companyName, innerX, 487, innerWidth, { boldValue: true });
        drawLineField('Nome Fantasia:', company.nomeFantasia, innerX, 455, innerWidth, { boldValue: true });
        drawLineField('CPF/CNPJ:', company.cnpj, innerX, 423, innerWidth, { boldValue: true });
        drawLineField('Endereço:', company.endereco, innerX, 391, 318, { boldValue: true });
        drawLineField('Nº:', company.numero, innerX + 335, 391, innerWidth - 335, { boldValue: true });
        drawLineField('Município:', company.municipio, innerX, 359, 318, { boldValue: true });
        drawLineField('Estado:', company.estado, innerX + 335, 359, innerWidth - 335, { boldValue: true });
        drawLineField('Inscrição Municipal:', company.inscricaoMunicipal, innerX, 327, 255, { boldValue: true });
        drawLineField('Inscrição Estadual:', company.inscricaoEstadual, innerX + 270, 327, innerWidth - 270, { boldValue: true });
        drawSectionHeader('DECLARAÇÃO', 287);
        const declaration = closing
          ? `Declaro encerrado o presente Livro Caixa, referente ao período informado, contendo ${bookLaunchCount} ${launchWord} escriturados em ordem cronológica e de forma clara e regular.`
          : 'Declaro aberto o presente Livro Caixa para registro das movimentações financeiras do contribuinte/entidade acima identificado, referentes ao período informado, devendo seus lançamentos ser realizados em ordem cronológica e de forma clara e regular.';
        wrappedText(declaration, innerX, 250, innerWidth, { size: 9.5, lineHeight: 15 });
        drawLineField('Local e data:', printedDate, innerX, 198, innerWidth, { boldValue: true });
        add(`0.7 w ${innerX + 12} 126 m ${innerX + 212} 126 l S`);
        add(`0.7 w ${innerX + 238} 126 m ${innerX + 438} 126 l S`);
        text('Assinatura do responsável', innerX + 12, 111, { bold: true, size: 8, align: 'center', width: 200 });
        text('Assinatura do contabilista', innerX + 238, 111, { bold: true, size: 8, align: 'center', width: 200 });
        page = savedPage;
        y = savedY;
        return commands;
      };
      if (options.terms !== false) {
        pages.unshift(createTermPage(false));
        pages.push(createTermPage(true));
      }
      const saved = page;
      pages.forEach((commands, index) => {
        page = commands;
        add(`0.4 w 35 29 m 560 29 l S`);
        text(`CAIXA FÁCIL - ${reportTitle}`, 35, 17, { size: 7 });
        text(`Folha ${index + 1} de ${pages.length}`, 420, 17, { size: 7, align: 'right', width: 140 });
      });
      page = saved;
      const objects = [];
      const addObject = body => {
        objects.push(body);
        return objects.length;
      };
      const pageIds = [];
      const contentIds = [];
      pages.forEach(commands => {
        const stream = commands.join('\n');
        contentIds.push(addObject(`<< /Length ${fujiPdfBytesFromString(stream).length} >>\nstream\n${stream}\nendstream`));
        pageIds.push(0);
      });
      const fontId = addObject('<< /F1 << /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >> >>');
      const pagesId = addObject('');
      pageIds.forEach((_, index) => {
        pageIds[index] = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font ${fontId} 0 R >> /Contents ${contentIds[index]} 0 R >>`);
      });
      objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
      const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
      const chunks = [fujiPdfBytesFromString('%PDF-1.4\n')];
      const offsets = [0];
      let length = chunks[0].length;
      objects.forEach((body, index) => {
        offsets.push(length);
        const chunk = fujiPdfBytesFromString(`${index + 1} 0 obj\n${body}\nendobj\n`);
        chunks.push(chunk);
        length += chunk.length;
      });
      const xrefOffset = length;
      let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
      offsets.slice(1).forEach(offset => xref += `${String(offset).padStart(10, '0')} 00000 n \n`);
      xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
      chunks.push(fujiPdfBytesFromString(xref));
      return new Blob(chunks, { type: 'application/pdf' });
    }


function buildBook(transactions, banks, year, options = {}) {
  const rows = [], openings = new Map(), sections = [];
  const start = options.start || `${year}-01-01`, end = options.end || `${year}-12-31`;
  const cents = value => Math.round(Number(value || 0) * 100);
  const valid = transactions.filter(t => t.status !== "cancelado" && t.date <= end);
  const accounts = new Map(banks.map(bank => [bank.name, bank]));
  valid.forEach(t => {
    if (t.type !== "entrada" && t.origem && !accounts.has(t.origem)) accounts.set(t.origem, {name:t.origem});
    if (t.type !== "saida" && t.destino && !accounts.has(t.destino)) accounts.set(t.destino, {name:t.destino});
  });
  const row = (t, section, amount) => ({...section, id:t.id, rowId:`${section.subcategoriaCode}-${t.id}`, data:t.date,
    numero:t.document_number || String(t.id), historico:t.description || "", signedValue:amount / 100});
  const bankGroups = new Map();
  [...accounts.values()].forEach((bank, index) => {
    const group = "Disponível";
    if (!bankGroups.has(group)) bankGroups.set(group, String(bankGroups.size + 1));
    const groupCode = bankGroups.get(group);
    const section = {categoriaCode:groupCode, categoriaLabel:group.toUpperCase(), subcategoriaCode:`${groupCode}.${index+1}`, subcategoriaLabel:bank.name.toUpperCase()};
    sections.push(section);
    let opening = cents(bank.initial_balance);
    valid.forEach(t => {
      let impact = 0;
      if (t.type !== "saida" && t.destino === bank.name) impact += cents(t.amount);
      if (t.type !== "entrada" && t.origem === bank.name) impact -= cents(t.amount);
      if (t.date < start) opening += impact;
      else if (impact) rows.push(row(t, section, impact));
    });
    openings.set(`${section.categoriaCode}|${section.categoriaLabel}|${section.subcategoriaCode}|${section.subcategoriaLabel}`, opening / 100);
  });
  const categories = new Map();
  valid.filter(t => t.date >= start && t.type !== "transferencia").forEach(t => {
    const name = t.category?.name || (t.type === "entrada" ? t.origem : t.destino) || "Sem categoria";
    if (!categories.has(name)) categories.set(name, {code:String(categories.size+bankGroups.size+1), subs:new Map()});
    const category = categories.get(name);
    const sub = "Movimentações";
    if (!category.subs.has(sub)) category.subs.set(sub, `${category.code}.${category.subs.size+1}`);
    // Contrapartida da conta financeira, conforme o modelo Fuji Finance.
    rows.push(row(t, {categoriaCode:category.code, categoriaLabel:name.toUpperCase(),
      subcategoriaCode:category.subs.get(sub), subcategoriaLabel:sub.toUpperCase()}, cents(t.amount) * (t.type === "entrada" ? -1 : 1)));
  });
  return {rows, openings, sections, start};
}
global.CaixaLivroPdf = {generate:fujiBookPdfBlob, download:fujiDownloadBlob, buildBook};
})(globalThis);
