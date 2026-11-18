// PDF-Erzeugung für Angebote, Auftragsbestätigungen und Rechnungen
// inkl. ZUGFeRD (PDF/A-3b mit eingebetteter factur-x.xml).
import { PDFDocument, PDFName, PDFHexString, PDFString, AFRelationship, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { calcTotals, eur, fmtDate, fmtNum, unitLabel, KINDS, fmt2, LAYOUT_DEFAULTS } from './util.js';
import { getFile } from './db.js';
import { buildCII } from './einvoice.js';

const MM = 72 / 25.4;
const W = 210 * MM;
const H = 297 * MM;
const BASE = import.meta.env?.BASE_URL ?? '/';

let assetCache;
async function assets() {
  if (globalThis.__crmAssets) return globalThis.__crmAssets;
  if (!assetCache) {
    const f = (p) => fetch(BASE + p).then((r) => r.arrayBuffer());
    const [regular, bold, icc] = await Promise.all([
      f('fonts/LiberationSans-Regular.ttf'),
      f('fonts/LiberationSans-Bold.ttf'),
      f('srgb.icc'),
    ]);
    assetCache = { regular, bold, icc };
  }
  return assetCache;
}

export { LAYOUT_DEFAULTS };

function wrap(text, font, size, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) <= maxW) line = test;
      else {
        if (line) out.push(line);
        // Sehr lange Wörter hart umbrechen
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxW) {
          let i = w.length;
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > maxW) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

async function loadLetterhead(pdf, company) {
  if (!company.letterheadFileId) return null;
  const f = globalThis.__crmLetterhead || (await getFile(company.letterheadFileId));
  if (!f) return null;
  const bytes = new Uint8Array(await f.data.arrayBuffer());
  if (f.mime === 'application/pdf') {
    const src = await PDFDocument.load(bytes);
    const idx = src.getPageCount() > 1 ? [0, 1] : [0];
    const pages = await pdf.embedPdf(src, idx);
    return { kind: 'pdf', first: pages[0], follow: pages[1] || pages[0] };
  }
  const img = f.mime === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  return { kind: 'image', img };
}

function drawLetterhead(page, lh, first, layout) {
  if (!lh) return;
  if (!first && !layout.letterheadAllPages) return;
  if (lh.kind === 'pdf') {
    const p = first ? lh.first : lh.follow;
    const s = Math.min(W / p.width, H / p.height);
    page.drawPage(p, { x: 0, y: H - p.height * s, xScale: s, yScale: s });
  } else {
    const s = W / lh.img.width;
    const h = Math.min(lh.img.height * s, H);
    page.drawImage(lh.img, { x: 0, y: H - h, width: W, height: h });
  }
}

export async function buildPdf(doc, company, customer, { zugferd = false } = {}) {
  const a = await assets();
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(a.regular, { subset: true });
  const bold = await pdf.embedFont(a.bold, { subset: true });
  const L = { ...LAYOUT_DEFAULTS, ...(company.layout || {}) };
  const lh = await loadLetterhead(pdf, company);
  const t = calcTotals(doc, company);
  const kind = KINDS[doc.kind];
  const title = doc.isCreditNote ? 'Gutschrift' : kind.pdfTitle || kind.label;

  const left = L.marginLeft * MM;
  const right = W - L.marginRight * MM;
  const width = right - left;
  const bottomY = L.bottom * MM;
  const black = rgb(0, 0, 0);
  const grey = rgb(0.35, 0.35, 0.35);

  const pages = [];
  let page;
  let y;
  const newPage = (first = false) => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    drawLetterhead(page, lh, first, L);
    if (!lh) drawDefaultHeaderFooter(page, first);
    y = H - (first ? L.contentTop : L.followTop) * MM;
  };
  const text = (s, x, yy, { f = font, size = 9.5, color = black, align = 'left' } = {}) => {
    s = String(s ?? '');
    let xx = x;
    if (align === 'right') xx = x - f.widthOfTextAtSize(s, size);
    if (align === 'center') xx = x - f.widthOfTextAtSize(s, size) / 2;
    page.drawText(s, { x: xx, y: yy, size, font: f, color });
  };
  const ensure = (h) => {
    if (y - h < bottomY) {
      newPage(false);
      return true;
    }
    return false;
  };

  function drawDefaultHeaderFooter(pg, first) {
    const prev = page;
    page = pg;
    if (first) {
      text(company.name, right, H - 20 * MM, { f: bold, size: 16, align: 'right' });
      const lines = [company.owner, company.street, `${company.zip || ''} ${company.city || ''}`.trim(), company.phone && 'Tel. ' + company.phone, company.email, company.web].filter(Boolean);
      lines.forEach((l, i) => text(l, right, H - 26 * MM - i * 11, { size: 8.5, color: grey, align: 'right' }));
    }
    const cols = [
      [company.name, company.street, `${company.zip || ''} ${company.city || ''}`.trim()],
      [company.phone && 'Tel. ' + company.phone, company.email, company.web],
      [company.bankName, company.iban && 'IBAN ' + company.iban, company.bic && 'BIC ' + company.bic],
      [company.vatId && 'USt-IdNr. ' + company.vatId, company.taxNumber && 'St.-Nr. ' + company.taxNumber, company.register],
    ];
    const cw = width / cols.length;
    pg.drawLine({ start: { x: left, y: 22 * MM }, end: { x: right, y: 22 * MM }, thickness: 0.4, color: grey });
    cols.forEach((c, ci) =>
      c.filter(Boolean).forEach((l, li) => text(l, left + ci * cw, 18 * MM - li * 9, { size: 7, color: grey }))
    );
    page = prev;
  }

  newPage(true);

  // Absenderzeile + Anschrift
  const addrTop = H - L.addressTop * MM;
  const sender = company.senderLine || [company.name, company.street, `${company.zip || ''} ${company.city || ''}`.trim()].filter(Boolean).join(' · ');
  text(sender, left, addrTop, { size: 7, color: grey });
  page.drawLine({ start: { x: left, y: addrTop - 2 }, end: { x: left + 85 * MM, y: addrTop - 2 }, thickness: 0.3, color: grey });
  const c = customer || {};
  const addr = [c.name, c.contact, c.street, c.street2, `${c.zip || ''} ${c.city || ''}`.trim(), c.country && c.country !== 'DE' ? c.country : ''].filter(Boolean);
  addr.forEach((l, i) => text(l, left, addrTop - 16 - i * 12.5, { size: 10 }));

  // Infoblock rechts
  const info = [
    [doc.isCreditNote ? 'Gutschriftnr.' : { angebot: 'Angebotsnr.', auftrag: 'Auftragsnr.', rechnung: 'Rechnungsnr.' }[doc.kind], doc.number || 'Entwurf'],
    ['Datum', fmtDate(doc.date)],
    c.number && ['Kundennr.', c.number],
    doc.kind === 'rechnung' && ['Leistungsdatum', doc.serviceDateText || fmtDate(doc.serviceDate || doc.date)],
    doc.kind === 'angebot' && doc.validUntil && ['Gültig bis', fmtDate(doc.validUntil)],
    doc.orderReference && ['Ihre Bestellung', doc.orderReference],
    c.vatId && doc.taxMode === 'reverse' && ['Ihre USt-IdNr.', c.vatId],
  ].filter(Boolean);
  const infoX = left + 105 * MM;
  info.forEach(([k, v], i) => {
    text(k, infoX, addrTop - 16 - i * 12.5, { size: 8.5, color: grey });
    text(v, right, addrTop - 16 - i * 12.5, { size: 9, align: 'right' });
  });

  // Titel
  y = Math.min(y, addrTop - 16 - Math.max(addr.length, info.length) * 12.5 - 30);
  text(`${title} ${doc.number || ''}`.trim(), left, y, { f: bold, size: 14 });
  y -= 18;
  if (doc.subject) {
    for (const l of wrap(doc.subject, bold, 10, width)) {
      text(l, left, y, { f: bold, size: 10 });
      y -= 13;
    }
  }
  y -= 6;
  const para = (s, size = 9.5) => {
    for (const l of wrap(s, font, size, width)) {
      ensure(13);
      text(l, left, y, { size });
      y -= 13;
    }
  };
  if (doc.intro) {
    para(doc.intro);
    y -= 8;
  }

  // Tabelle
  const col = {
    pos: left,
    desc: left + 10 * MM,
    qty: left + 110 * MM,
    unit: left + 112 * MM,
    price: left + 143 * MM,
    total: right,
  };
  const descW = col.qty - col.desc - 18 * MM;
  const header = () => {
    ensure(30);
    page.drawRectangle({ x: left - 2, y: y - 4, width: width + 4, height: 15, color: rgb(0.93, 0.93, 0.93) });
    text('Pos.', col.pos, y, { f: bold, size: 8.5 });
    text('Beschreibung', col.desc, y, { f: bold, size: 8.5 });
    text('Menge', col.qty, y, { f: bold, size: 8.5, align: 'right' });
    text('Einheit', col.unit, y, { f: bold, size: 8.5 });
    text('Einzelpreis', col.price, y, { f: bold, size: 8.5, align: 'right' });
    text('Gesamt', col.total, y, { f: bold, size: 8.5, align: 'right' });
    y -= 18;
  };
  header();
  t.lines.forEach((l, i) => {
    const titleLines = l.title ? wrap(l.title, bold, 9.5, descW) : [];
    const descLines = l.desc ? wrap(l.desc, font, 8.5, descW) : [];
    const h = titleLines.length * 12 + descLines.length * 11 + 6;
    if (ensure(Math.min(h, 60))) header();
    text(String(i + 1), col.pos, y);
    text(fmtNum(l.qty), col.qty, y, { align: 'right' });
    text(unitLabel(l.unit), col.unit, y);
    text(fmt2(l.price), col.price, y, { align: 'right' });
    text(fmt2(l.net), col.total, y, { align: 'right' });
    for (const tl of titleLines) {
      if (ensure(12)) header();
      text(tl, col.desc, y, { f: bold });
      y -= 12;
    }
    for (const dl of descLines) {
      if (ensure(11)) header();
      text(dl, col.desc, y, { size: 8.5, color: grey });
      y -= 11;
    }
    if (!titleLines.length && !descLines.length) y -= 12;
    y -= 6;
  });

  // Summen
  ensure(20 + t.groups.length * 13 + 30);
  page.drawLine({ start: { x: left + 95 * MM, y: y + 4 }, end: { x: right, y: y + 4 }, thickness: 0.5 });
  y -= 8;
  const sumRow = (k, v, b = false) => {
    text(k, left + 95 * MM, y, { f: b ? bold : font });
    text(v, right, y, { f: b ? bold : font, align: 'right' });
    y -= 13;
  };
  sumRow('Summe netto', eur(t.net));
  if (!company.smallBusiness && doc.taxMode !== 'reverse') t.groups.forEach((g) => sumRow(`zzgl. ${fmtNum(g.rate)} % USt. auf ${eur(g.base)}`, eur(g.tax)));
  page.drawLine({ start: { x: left + 95 * MM, y: y + 9 }, end: { x: right, y: y + 9 }, thickness: 0.5 });
  y -= 2;
  sumRow(doc.kind === 'rechnung' ? 'Rechnungsbetrag' : 'Gesamtbetrag', eur(t.gross), true);
  if (Number(doc.prepaid) > 0) {
    sumRow('abzgl. Anzahlung', eur(-doc.prepaid));
    sumRow('Noch zu zahlen', eur(t.gross - doc.prepaid), true);
  }
  y -= 10;

  if (company.smallBusiness) para('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.', 8.5);
  if (doc.taxMode === 'reverse') para('Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG.', 8.5);
  if (doc.kind === 'rechnung' && doc.paymentTerms) {
    y -= 4;
    para(doc.paymentTerms);
  }
  if (doc.kind === 'rechnung' && company.privateNotice && !c.vatId) {
    y -= 4;
    para(company.privateNotice, 8);
  }
  if (doc.outro) {
    y -= 8;
    para(doc.outro);
  }

  // Seitenzahlen
  if (pages.length > 1)
    pages.forEach((p, i) => {
      page = p;
      text(`Seite ${i + 1} von ${pages.length}`, right, (L.bottom - 6) * MM, { size: 7.5, color: grey, align: 'right' });
    });

  // Metadaten
  const now = new Date();
  now.setMilliseconds(0);
  const docTitle = `${title} ${doc.number || ''}`.trim();
  pdf.setTitle(docTitle);
  pdf.setAuthor(company.name || '');
  pdf.setSubject(doc.subject || docTitle);
  pdf.setCreator('Handwerk CRM');
  pdf.setProducer('Handwerk CRM (pdf-lib)');
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  pdf.setLanguage('de-DE');

  if (zugferd) {
    const xml = buildCII(doc, company, customer, 'zugferd');
    await makePdfA3(pdf, a.icc, xml, { title: docTitle, author: company.name || '', subject: doc.subject || docTitle, date: now });
  }
  return pdf.save({ useObjectStreams: false });
}

// --- PDF/A-3b + Factur-X/ZUGFeRD ---
function xmlEsc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function isoDate(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

async function makePdfA3(pdf, iccBytes, xml, meta) {
  const ctx = pdf.context;
  const xmlBytes = new TextEncoder().encode(xml);
  await pdf.attach(xmlBytes, 'factur-x.xml', {
    mimeType: 'text/xml',
    description: 'Factur-X/ZUGFeRD Rechnungsdaten',
    creationDate: meta.date,
    modificationDate: meta.date,
    afRelationship: AFRelationship.Alternative,
  });

  // OutputIntent mit sRGB-Profil
  const icc = ctx.flateStream(new Uint8Array(iccBytes), { N: 3 });
  const iccRef = ctx.register(icc);
  const intent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: iccRef,
  });
  pdf.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(intent)]));

  // Datei-ID im Trailer (Pflicht bei PDF/A)
  const id = PDFHexString.of(
    [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
  );
  ctx.trailerInfo.ID = ctx.obj([id, id]);

  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
<pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(meta.title)}</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>${xmlEsc(meta.author)}</rdf:li></rdf:Seq></dc:creator>
<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(meta.subject)}</rdf:li></rdf:Alt></dc:description>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
<pdf:Producer>Handwerk CRM (pdf-lib)</pdf:Producer>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
<xmp:CreatorTool>Handwerk CRM</xmp:CreatorTool>
<xmp:CreateDate>${isoDate(meta.date)}</xmp:CreateDate>
<xmp:ModifyDate>${isoDate(meta.date)}</xmp:ModifyDate>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
<pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
<pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
<pdfaSchema:prefix>fx</pdfaSchema:prefix>
<pdfaSchema:property><rdf:Seq>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>name of the embedded XML invoice file</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description></rdf:li>
</rdf:Seq></pdfaSchema:property>
</rdf:li></rdf:Bag></pdfaExtension:schemas>
</rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
<fx:DocumentType>INVOICE</fx:DocumentType>
<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
<fx:Version>1.0</fx:Version>
<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const xmpStream = ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  pdf.catalog.set(PDFName.of('Metadata'), ctx.register(xmpStream));
  pdf.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
}
