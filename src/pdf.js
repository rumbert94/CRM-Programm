// PDF-Erzeugung für Angebote, Auftragsbestätigungen und Rechnungen
// inkl. ZUGFeRD (PDF/A-3b mit eingebetteter factur-x.xml).
import { PDFDocument, PDFName, PDFHexString, PDFString, AFRelationship, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { calcTotals, fmtDate, unitLabel, KINDS, fmt2, LAYOUT_DEFAULTS, numberItems, round2, docTitle } from './util.js';
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

async function loadImage(pdf, fileId, override) {
  if (!fileId) return null;
  const f = override || (await getFile(fileId));
  if (!f) return null;
  const bytes = new Uint8Array(await f.data.arrayBuffer());
  return f.mime === 'image/png' ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
}

export function footerLines(c) {
  if (c.footerText?.trim()) return c.footerText.split('\n').filter((l) => l.trim());
  const j = (arr) => arr.filter(Boolean).join(' • ');
  return [
    j([c.name, c.footerExtra, c.owner && 'Inh. ' + c.owner, c.street, `${c.zip || ''} ${c.city || ''}`.trim()]),
    j([c.bankName, c.iban && 'IBAN ' + c.iban, c.bic && 'BIC ' + c.bic, c.vatId ? 'USt-ID-Nr.: ' + c.vatId : c.taxNumber && 'St.-Nr.: ' + c.taxNumber]),
    j([c.phone && 'Tel.: ' + c.phone, c.email && 'Mail: ' + c.email, c.web && 'Web: ' + c.web]),
  ].filter(Boolean);
}

export async function buildPdf(doc, company, customer, { zugferd = false } = {}) {
  const a = await assets();
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(a.regular, { subset: true });
  const bold = await pdf.embedFont(a.bold, { subset: true });
  const L = { ...LAYOUT_DEFAULTS, ...(company.layout2 || {}) };
  const lh = await loadLetterhead(pdf, company);
  const logo = lh ? null : await loadImage(pdf, company.logoFileId, globalThis.__crmLogo);
  const t = calcTotals(doc, company);
  const kind = KINDS[doc.kind];
  const title = docTitle(doc);

  const FS = 10; // Grundschrift (Arial-kompatibel)
  const LH = 12; // Zeilenabstand
  const left = L.marginLeft * MM;
  const right = W - L.marginRight * MM;
  const width = right - left;
  const bottomY = L.bottom * MM;
  const black = rgb(0, 0, 0);
  const mm = (v) => left + (v - 20) * MM; // Spaltenpositionen relativ zu 20 mm Rand

  const pages = [];
  let page;
  let y;
  const text = (s, x, yy, { f = font, size = FS, align = 'left' } = {}) => {
    s = String(s ?? '');
    let xx = x;
    if (align === 'right') xx = x - f.widthOfTextAtSize(s, size);
    if (align === 'center') xx = x - f.widthOfTextAtSize(s, size) / 2;
    page.drawText(s, { x: xx, y: yy, size, font: f, color: black });
  };
  const hline = (yy, th = 0.5, x1 = left, x2 = right) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: th, color: black });

  const drawFooter = () => {
    if (lh) return;
    const lines = footerLines(company);
    if (!lines.length) return;
    const fy = 16 * MM + (lines.length - 1) * 10;
    hline(fy + 12, 0.5, left, right - 6 * MM);
    lines.forEach((l, i) => text(l, (left + right - 6 * MM) / 2, fy - i * 10, { size: 8, align: 'center' }));
  };
  const newPage = (first = false) => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    drawLetterhead(page, lh, first, L);
    if (first && logo) page.drawImage(logo, { x: L.logoX * MM, y: H - (L.logoY + L.logoH) * MM, width: L.logoW * MM, height: L.logoH * MM });
    if (L.foldMarks) [105, 148.5, 210].forEach((v) => page.drawLine({ start: { x: 4 * MM, y: H - v * MM }, end: { x: (v === 148.5 ? 7 : 8) * MM, y: H - v * MM }, thickness: 0.4, color: black }));
    drawFooter();
    y = H - (first ? L.contentTop : L.followTop) * MM;
  };
  const ensure = (h) => {
    if (y - h < bottomY) {
      newPage(false);
      return true;
    }
    return false;
  };

  newPage(true);
  const c = customer || {};

  // Absenderzeile (8 pt, schwarz, unterstrichen bis Textende)
  const addrTop = H - L.addressTop * MM - 7;
  const sender = company.senderLine || [company.name, company.street, `${company.zip || ''} ${company.city || ''}`.trim()].filter(Boolean).join(' • ');
  text(sender, left, addrTop, { size: 8 });
  hline(addrTop - 1.5, 0.4, left, left + font.widthOfTextAtSize(sender, 8));
  const addr = [c.name, c.contact, c.street, c.street2, `${c.zip || ''} ${c.city || ''}`.trim(), c.country && c.country !== 'DE' ? c.country : ''].filter(Boolean);
  addr.forEach((l, i) => text(l, left, addrTop - 14 - i * LH));

  // Infoblock rechts (Kunden Nr., Datum …)
  const info = [
    c.number && ['Kunden Nr.:', c.number],
    ['Datum:', fmtDate(doc.date)],
    doc.kind === 'angebot' && doc.validUntil && ['Gültig bis:', fmtDate(doc.validUntil)],
    doc.orderReference && ['Ihre Bestellung:', doc.orderReference],
    c.vatId && doc.taxMode === 'reverse' && ['Ihre USt-IdNr.:', c.vatId],
  ].filter(Boolean);
  const infoY = H - L.infoTop * MM - 7;
  info.forEach(([k, v], i) => {
    text(k, mm(138), infoY - i * LH);
    text(v, mm(188), infoY - i * LH, { align: 'right' });
  });

  // Überschrift
  y = Math.min(y - 9, infoY - info.length * LH - 20, addrTop - 14 - addr.length * LH - 20);
  text(`${title} Nr. ${doc.number || '(Entwurf)'}`, left, y, { f: bold, size: 12 });
  y -= 22;
  if (doc.kind === 'rechnung' || doc.kind === 'auftrag') {
    const period = doc.serviceMode === 'period' && (doc.serviceFrom || doc.serviceTo);
    if (period) {
      text('Leistungszeitraum:', left, y);
      text(`${fmtDate(doc.serviceFrom)} – ${fmtDate(doc.serviceTo)}`, mm(54), y);
      y -= LH + 8;
    } else if (doc.kind === 'rechnung') {
      text('Leistungsdatum:', left, y);
      text(fmtDate(doc.serviceDate || doc.date), mm(54), y);
      y -= LH + 8;
    }
  }
  if (doc.subject) {
    for (const l of wrap(doc.subject, font, FS, width)) {
      text(l, left, y);
      y -= LH;
    }
    y -= 8;
  }
  const para = (s, size = FS) => {
    for (const l of wrap(s, font, size, width)) {
      ensure(LH);
      text(l, left, y, { size });
      y -= size + 2;
    }
  };
  if (doc.intro) {
    para(doc.intro);
    y -= 8;
  }

  // Tabelle (Spalten wie Lexware-Vorlage, mm ab Seitenrand)
  const col = { pos: mm(21), qty: mm(39.5), unit: mm(41.5), desc: mm(60), price: mm(164), total: right - 1 * MM };
  const descW = mm(140) - col.desc;
  const header = () => {
    ensure(40);
    y -= 4;
    hline(y + 12, 0.5);
    text('Pos', col.pos, y);
    text('Menge', mm(40), y, { align: 'center' });
    text('Beschreibung', col.desc, y);
    text('Einzelpreis', mm(152.5), y, { align: 'center' });
    text('EUR', mm(152.5), y - LH, { align: 'center' });
    text('Gesamtpreis', mm(180), y, { align: 'center' });
    text('EUR', mm(180), y - LH, { align: 'center' });
    y -= LH + 5;
    hline(y, 0.5);
    y -= LH + 1;
  };
  header();
  const numbered = numberItems(doc.items);
  const groupSum = {};
  numbered.filter((n) => !n.isTitle).forEach((n, k) => {
    n.line = t.lines[k];
    groupSum[n.title] = round2((groupSum[n.title] || 0) + n.line.net);
  });
  const subtotal = (tn, name) => {
    if (ensure(LH + 8)) header();
    hline(y + 11, 0.3, col.desc, right);
    text(`Summe ${tn} ${name || ''}`.trim(), col.desc, y, { f: bold });
    text(fmt2(groupSum[tn] || 0), col.total, y, { f: bold, align: 'right' });
    y -= LH + 8;
  };
  numbered.forEach((n, idx) => {
    const it = n.item;
    if (n.isTitle) {
      if (ensure(LH * 3)) header();
      y -= 2;
      text(n.pos, col.pos, y, { f: bold });
      for (const tl of wrap(it.title || 'Titel', bold, FS, mm(194) - col.desc)) {
        text(tl, col.desc, y, { f: bold });
        y -= LH;
      }
      y -= 4;
    } else {
      const l = n.line;
      const hasDesc = !!(it.desc && it.desc.trim());
      const titleLines = it.title ? wrap(it.title, hasDesc ? bold : font, FS, descW) : [];
      const descLines = hasDesc ? wrap(it.desc, font, FS, descW) : [];
      const h = (titleLines.length + descLines.length) * LH;
      if (ensure(Math.min(h, 5 * LH))) header();
      text(n.pos, col.pos, y);
      text(fmt2(l.qty), col.qty, y, { align: 'right' });
      text(unitLabel(l.unit), col.unit, y);
      text(fmt2(l.price), col.price, y, { align: 'right' });
      text(fmt2(l.net), col.total, y, { align: 'right' });
      for (const tl of titleLines) {
        if (ensure(LH)) header();
        text(tl, col.desc, y, { f: hasDesc ? bold : font });
        y -= LH;
      }
      for (const dl of descLines) {
        if (ensure(LH)) header();
        text(dl, col.desc, y);
        y -= LH;
      }
      if (!titleLines.length && !descLines.length) y -= LH;
      y -= 5;
    }
    const next = numbered[idx + 1];
    if (n.title && !n.isTitle && (!next || next.isTitle)) {
      const tItem = numbered.find((x) => x.isTitle && x.title === n.title)?.item;
      subtotal(n.title, tItem?.title);
    }
  });

  // Summenblock
  const noTax = company.smallBusiness || doc.taxMode === 'reverse';
  ensure(LH * (4 + t.groups.length) + 20);
  y -= 1;
  const row = (label, base, val) => {
    hline(y + 11, 0.5);
    text(label, mm(22), y);
    if (base !== null) text(base, col.price, y, { align: 'right' });
    text(val, col.total, y, { align: 'right' });
    y -= LH + 5;
  };
  row('Gesamt Netto', null, fmt2(t.net));
  if (!noTax) t.groups.forEach((g) => row(`zzgl. ${fmt2(g.rate)} % USt. auf`, fmt2(g.base), fmt2(g.tax)));
  hline(y + 11, 0.5);
  y -= 12;
  text('Gesamtbetrag', mm(22), y, { f: bold });
  text(fmt2(t.gross), col.total, y, { f: bold, align: 'right' });
  y -= 5;
  hline(y, 1.2);
  y -= LH + 8;
  if (doc.deductions?.length) {
    text('abzüglich bereits berechneter Abschlagsrechnungen:', mm(22), y, { f: bold });
    y -= LH + 2;
    for (const x of doc.deductions) {
      ensure(LH * 2);
      text(`${x.title || 'Abschlagsrechnung'} Nr. ${x.number} vom ${fmtDate(x.date)}`, mm(22), y);
      text(`netto ${fmt2(x.net)} + USt. ${fmt2(x.tax)}`, col.price, y, { align: 'right' });
      text(fmt2(-x.gross), col.total, y, { align: 'right' });
      y -= LH + 2;
    }
    hline(y + 9, 0.5);
    y -= 4;
    text('Noch zu zahlen', mm(22), y, { f: bold });
    text(fmt2(round2(t.gross - doc.prepaid)), col.total, y, { f: bold, align: 'right' });
    y -= 5;
    hline(y, 1.2);
    y -= LH + 8;
  } else if (Number(doc.prepaid) > 0) {
    text('abzgl. bereits gezahlt', mm(22), y);
    text(fmt2(-doc.prepaid), col.total, y, { align: 'right' });
    y -= LH;
    text('Noch zu zahlen', mm(22), y, { f: bold });
    text(fmt2(t.gross - doc.prepaid), col.total, y, { f: bold, align: 'right' });
    y -= LH + 8;
  }

  if (company.smallBusiness) para('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
  if (doc.taxMode === 'reverse') para('Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG.');
  if (doc.paymentTerms) {
    para(doc.paymentTerms);
    y -= 8;
  }
  if (doc.outro) {
    para(doc.outro);
    y -= 8;
  }
  const kindOn = (key, def) => {
    if (company.textsOn?.[key] === false) return false;
    const v = company.textsKinds?.[key]?.[doc.kind];
    return v === undefined ? def.includes(doc.kind) : !!v;
  };
  if (company.privateNotice && kindOn('privateNotice', ['rechnung']) && !c.vatId) {
    para(company.privateNotice);
    y -= 8;
  }
  if (company.texts?.extraText && kindOn('extraText', ['angebot', 'auftrag', 'rechnung'])) para(company.texts.extraText);

  // Seitenzahlen
  if (pages.length > 1)
    pages.forEach((p, i) => {
      page = p;
      text(`Seite ${i + 1} von ${pages.length}`, right, (L.bottom - 4) * MM, { size: 8, align: 'right' });
    });

  // Metadaten
  const now = new Date();
  now.setMilliseconds(0);
  const metaTitle = `${title} Nr. ${doc.number || ''}`.trim();
  pdf.setTitle(metaTitle);
  pdf.setAuthor(company.name || '');
  pdf.setSubject(doc.subject || metaTitle);
  pdf.setCreator('Handwerk CRM');
  pdf.setProducer('Handwerk CRM (pdf-lib)');
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);
  pdf.setLanguage('de-DE');

  if (zugferd) {
    const xml = buildCII(doc, company, customer, 'zugferd');
    await makePdfA3(pdf, a.icc, xml, { title: metaTitle, author: company.name || '', subject: doc.subject || metaTitle, date: now });
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
