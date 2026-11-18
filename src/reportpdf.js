// PDF für Regieberichte (Arbeitsauftrag / -protokoll) mit Unterschriften
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fmtDate, fmtNum, unitLabel, LAYOUT_DEFAULTS } from './util.js';
import { assets, wrap, loadImage, loadLetterhead, drawLetterhead, footerLines } from './pdf.js';
import { TRAVEL, SURCHARGE, travelPrice, spanHours, workerHours, totalHours, REGIE_LEGAL_DEFAULT } from './report.js';

const MM = 72 / 25.4;
const W = 210 * MM;
const H = 297 * MM;

export async function buildReportPdf(r, company, customer) {
  const a = await assets();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(a.regular, { subset: true });
  const bold = await pdf.embedFont(a.bold, { subset: true });
  const L = { ...LAYOUT_DEFAULTS, ...(company.layout2 || {}) };
  const lh = await loadLetterhead(pdf, company);
  const logo = lh ? null : await loadImage(pdf, company.logoFileId, globalThis.__crmLogo);
  const black = rgb(0, 0, 0);
  const grey = rgb(0.35, 0.35, 0.35);
  const left = L.marginLeft * MM;
  const right = W - L.marginRight * MM;
  const width = right - left;
  const FS = 10;
  const LH = 12.5;
  const footer = footerLines(company);
  const bottomY = ((L.footerBottom ?? 7) + 6) * MM + footer.length * 10 + 10;

  let page;
  let y;
  const text = (s, x, yy, { f = font, size = FS, align = 'left', color = black } = {}) => {
    s = String(s ?? '');
    let xx = x;
    if (align === 'right') xx = x - f.widthOfTextAtSize(s, size);
    if (align === 'center') xx = x - f.widthOfTextAtSize(s, size) / 2;
    page.drawText(s, { x: xx, y: yy, size, font: f, color });
  };
  const hline = (yy, th = 0.5, x1 = left, x2 = right) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: th, color: black });
  const box = (x, yy, w, h, th = 0.6) => page.drawRectangle({ x, y: yy, width: w, height: h, borderColor: black, borderWidth: th });
  const check = (x, yy, on) => {
    box(x, yy - 1, 8, 8, 0.6);
    if (on) {
      page.drawLine({ start: { x: x + 1.5, y: yy + 0.5 }, end: { x: x + 6.5, y: yy + 5.5 }, thickness: 1.1, color: black });
      page.drawLine({ start: { x: x + 1.5, y: yy + 5.5 }, end: { x: x + 6.5, y: yy + 0.5 }, thickness: 1.1, color: black });
    }
  };
  const newPage = (first) => {
    page = pdf.addPage([W, H]);
    drawLetterhead(page, lh, first, L);
    if (first && logo) page.drawImage(logo, { x: L.logoX * MM, y: H - (L.logoY + L.logoH) * MM, width: L.logoW * MM, height: L.logoH * MM });
    if (!lh && footer.length) {
      const fy = (L.footerBottom ?? 7) * MM + (footer.length - 1) * 10;
      hline(fy + 15, 0.5, left, right - 6 * MM);
      footer.forEach((l, i) => text(l, (left + right - 6 * MM) / 2, fy - i * 10, { size: 8, align: 'center' }));
    }
    y = H - (first ? 20 : L.followTop) * MM;
  };
  const ensure = (h) => {
    if (y - h < bottomY) {
      newPage(false);
      return true;
    }
    return false;
  };
  const para = (s, size = FS, f = font, x = left, w = width, color = black) => {
    for (const l of wrap(s, f, size, w)) {
      ensure(size + 3);
      text(l, x, y, { size, f, color });
      y -= size + 3;
    }
  };

  newPage(true);
  const c = customer || {};

  // Kopf
  text(`Regiebericht${r.number ? ' Nr. ' + r.number : ' (Entwurf)'}`, left, y - 8, { f: bold, size: 15 });
  text('Arbeitsauftrag / -protokoll', left, y - 22, { size: 9, color: grey });
  y = Math.min(y - 40, H - (L.logoY + L.logoH + 6) * MM);

  // Auftraggeber + Eckdaten
  const colR = left + width * 0.6;
  const top = y;
  text('Auftraggeber', left, y, { f: bold, size: 9 });
  y -= LH;
  for (const l of [c.name, c.contact, c.street, `${c.zip || ''} ${c.city || ''}`.trim(), c.phone && 'Tel.: ' + c.phone].filter(Boolean)) {
    text(l, left, y);
    y -= LH;
  }
  if (r.project) {
    y -= 3;
    text('Vorhaben:', left, y, { f: bold });
    const ls = wrap(r.project, font, FS, colR - left - 70);
    ls.forEach((l, i) => text(l, left + 62, y - i * LH));
    y -= ls.length * LH;
  }
  let yr = top;
  const info = [
    ['Datum:', fmtDate(r.date)],
    ['Beginn:', r.start ? r.start + ' Uhr' : '–'],
    ['Ende:', r.end ? r.end + ' Uhr' : '–'],
    ['Pause:', r.pause ? fmtNum(r.pause) + ' Min.' : '–'],
    c.number && ['Kunden Nr.:', c.number],
  ].filter(Boolean);
  for (const [k, v] of info) {
    text(k, colR, yr);
    text(v, right, yr, { align: 'right' });
    yr -= LH;
  }
  y = Math.min(y, yr) - 14;

  // Monteure
  const ws = r.workers?.length ? r.workers : [{ name: '', hours: '' }];
  text('Monteur', left + 4, y, { f: bold });
  text('Stunden', right - 4, y, { f: bold, align: 'right' });
  y -= 5;
  hline(y, 0.8);
  y -= LH;
  for (const w of ws) {
    ensure(LH);
    text(w.name || 'Monteur', left + 4, y);
    text(fmtNum(workerHours(r, w)), right - 4, y, { align: 'right' });
    y -= 4;
    hline(y, 0.3);
    y -= LH - 2;
  }
  text('Gesamt', left + 4, y, { f: bold });
  text(fmtNum(totalHours(r)) + ' Std', right - 4, y, { f: bold, align: 'right' });
  y -= 22;

  // Pauschalen und Zulagen als Ankreuzfelder
  ensure(80);
  const gap = 8;
  const bw = [width * 0.36, width * 0.4, width * 0.24 - 2 * gap];
  const bx = [left, left + bw[0] + gap, left + bw[0] + bw[1] + 2 * gap];
  const rows = Math.max(TRAVEL.length, SURCHARGE.length);
  const bh = 18 + rows * 13;
  const by = y - bh + 10;
  const heads = ['Fahrtkostenpauschale', 'Überstunden- / Arbeitszeitzulage', 'Schmutzzulage*'];
  heads.forEach((h, i) => {
    box(bx[i], by, bw[i], bh);
    text(h, bx[i] + 5, y, { f: bold, size: 8.5 });
  });
  TRAVEL.forEach((t, i) => {
    const yy = y - 16 - i * 13;
    check(bx[0] + 5, yy, r.travel === t.key);
    text(t.km ? `< ${t.km} km` : 'ohne', bx[0] + 18, yy, { size: 9 });
    if (t.km) text(fmtNum(travelPrice(company, t.key)) + ' €', bx[0] + bw[0] - 6, yy, { size: 9, align: 'right' });
  });
  SURCHARGE.forEach((s, i) => {
    const yy = y - 16 - i * 13;
    check(bx[1] + 5, yy, r.surcharge === s.key);
    text(s.label, bx[1] + 18, yy, { size: 9 });
  });
  [['ohne', !r.dirt], ['50 %', !!r.dirt]].forEach(([l, on], i) => {
    const yy = y - 16 - i * 13;
    check(bx[2] + 5, yy, on);
    text(l, bx[2] + 18, yy, { size: 9 });
  });
  y = by - 18;

  // Ausgeführte Arbeiten
  ensure(40);
  const cQty = left + 38;
  const cUnit = left + 44;
  const cDesc = left + 92;
  text('Menge', cQty, y, { f: bold, align: 'right' });
  text('Einheit', cUnit, y, { f: bold });
  text('Ausgeführte Arbeiten, Materialverbrauch, Vereinbarungen', cDesc, y, { f: bold });
  y -= 5;
  hline(y, 0.8);
  y -= LH;
  const items = (r.items || []).filter((i) => i.desc?.trim());
  if (!items.length) {
    text('–', cDesc, y);
    y -= LH;
  }
  for (const it of items) {
    const ls = wrap(it.desc, font, FS, right - cDesc);
    ensure(ls.length * LH + 4);
    text(fmtNum(it.qty || 0), cQty, y, { align: 'right' });
    text(unitLabel(it.unit), cUnit, y);
    ls.forEach((l, i) => text(l, cDesc, y - i * LH));
    y -= ls.length * LH - LH + 4;
    hline(y, 0.3);
    y -= LH - 2;
  }
  if (r.notes?.trim()) {
    y -= 4;
    ensure(30);
    text('Bemerkungen', left, y, { f: bold });
    y -= LH;
    para(r.notes);
  }
  y -= 10;

  // Hinweise / Bestätigung
  para(company.regie?.legalText?.trim() || REGIE_LEGAL_DEFAULT, 8, font, left, width, grey);
  y -= 14;

  // Unterschriften
  const sigH = 22 * MM;
  ensure(sigH + 50);
  const sw = (width - 20) / 2;
  const sigs = [
    [r.signature, 'Unterschrift Auftraggeber'],
    [r.monteurSig, 'Unterschrift Monteur'],
  ];
  for (let i = 0; i < 2; i++) {
    const [s, label] = sigs[i];
    const x = left + i * (sw + 20);
    if (s?.img) {
      try {
        const bytes = Uint8Array.from(atob(s.img.split(',')[1]), (ch) => ch.charCodeAt(0));
        const img = await pdf.embedPng(bytes);
        const sc = Math.min(sw / img.width, sigH / img.height);
        page.drawImage(img, { x, y: y - sigH + 2, width: img.width * sc, height: img.height * sc });
      } catch (e) {
        console.error(e);
      }
    }
    hline(y - sigH, 0.6, x, x + sw);
    text(label, x, y - sigH - 11, { size: 8.5 });
    if (s) {
      text(s.name || '', x, y - sigH - 23, { f: bold, size: 9 });
      text('unterschrieben am ' + new Date(s.at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) + ' Uhr', x, y - sigH - 34, { size: 8, color: grey });
    }
  }
  y -= sigH + 46;
  if (r.hash) {
    ensure(12);
    text(`Elektronisch unterschrieben am Gerät. Prüfsumme (SHA-256): ${r.hash.slice(0, 32)}…`, left, y, { size: 7, color: grey });
  }

  pdf.setTitle(`Regiebericht ${r.number || ''}`.trim());
  pdf.setAuthor(company.name || '');
  pdf.setCreator('Handwerk CRM');
  pdf.setLanguage('de-DE');
  return pdf.save();
}

export { spanHours };
