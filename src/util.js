// Kleine Helfer: IDs, Geld, Datum, HTML-Escaping

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Rundung kaufmännisch auf 2 Stellen
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const parseNum = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return 0;
  // "1.234,56" oder "1234,56" oder "1234.56"
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(norm);
  return Number.isFinite(n) ? n : 0;
};

const eurFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const numFmt = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });
const num2Fmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const eur = (n) => eurFmt.format(n || 0);
export const fmtNum = (n) => numFmt.format(n || 0);
export const fmt2 = (n) => num2Fmt.format(n || 0);

export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso, days) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};
export const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
};
export const fmtDateTime = (ms) =>
  new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

// Einheiten nach UN/ECE Recommendation 20 (Pflicht für E-Rechnung)
export const UNITS = [
  { code: 'H87', label: 'Stück' },
  { code: 'HUR', label: 'Std' },
  { code: 'MIN', label: 'Min' },
  { code: 'DAY', label: 'Tag' },
  { code: 'MTR', label: 'm' },
  { code: 'MTK', label: 'm²' },
  { code: 'MTQ', label: 'm³' },
  { code: 'LTR', label: 'l' },
  { code: 'KGM', label: 'kg' },
  { code: 'TNE', label: 't' },
  { code: 'KMT', label: 'km' },
  { code: 'LS', label: 'pauschal' },
  { code: 'SET', label: 'Satz' },
];
export const unitLabel = (code) => UNITS.find((u) => u.code === code)?.label || code || '';

export const KINDS = {
  angebot: { label: 'Angebot', plural: 'Angebote', prefix: '{JJ}', digits: 2, file: 'AN' },
  auftrag: { label: 'Auftrag', plural: 'Aufträge', prefix: '{JJ}', digits: 2, pdfTitle: 'Auftragsbestätigung', file: 'AB' },
  rechnung: { label: 'Rechnung', plural: 'Rechnungen', prefix: '{JJ}', digits: 2, file: 'R' },
};
// Frühere Standardpräfixe (werden automatisch auf die neuen umgestellt)
// Eigener Nummernkreis für Stornorechnungen (Dateiname S2601)
export const STORNO = { label: 'Stornorechnung', prefix: '{JJ}', digits: 2, file: 'S' };
export const OLD_PREFIXES = ['AN-{JAHR}-', 'AB-{JAHR}-', 'RE-{JAHR}-', 'A{JJ}', 'AB{JJ}'];

export function numberPrefix(kind, c, date = new Date()) {
  let cfg = c?.numbering?.[kind] || {};
  const def = KINDS[kind] || STORNO;
  if (!cfg.prefix || OLD_PREFIXES.includes(cfg.prefix)) cfg = { ...cfg, prefix: def.prefix, digits: cfg.digits ?? def.digits };
  const y = String(date.getFullYear());
  return { prefix: cfg.prefix.replace('{JAHR}', y).replace('{JJ}', y.slice(2)), digits: Number(cfg.digits ?? def.digits ?? 4) };
}

// Dateiname wie in Lexware: Rechnung 2609 -> R2609
// Dateiname: Rechnung 2609 -> R2609, Angebot 2601 -> AN2601, Auftrag 2601 -> AB2601
export const docFileName = (d) => {
  if (!d.number) return `${d.isStorno ? 'Storno' : KINDS[d.kind].label}-Entwurf`;
  return (d.isStorno ? STORNO.file : KINDS[d.kind].file) + d.number.replace(/^[A-Za-z]+-?/, '');
};

// Positionsnummern (mit Titeln: 1, 1.1, 1.2, 2, 2.1 …) und Titel-Zwischensummen
export function numberItems(items = []) {
  const hasTitles = items.some((i) => i.type === 'title');
  let t = 0;
  let p = 0;
  const out = [];
  for (const it of items) {
    if (it.type === 'title') {
      t++;
      p = 0;
      out.push({ item: it, pos: String(t), isTitle: true, title: t });
    } else {
      p++;
      out.push({ item: it, pos: hasTitles ? (t ? `${t}.${p}` : String(p)) : String(p), title: t });
    }
  }
  return out;
}

export const STATUS = {
  angebot: ['Entwurf', 'Versendet', 'Angenommen', 'Abgelehnt'],
  auftrag: ['Offen', 'In Arbeit', 'Erledigt'],
  rechnung: ['Entwurf', 'Versendet', 'Bezahlt', 'Storniert'],
};

// Summen nach EN 16931: Positionen auf Cent runden, Steuer je Satz auf die Summe
export function calcTotals(doc, company) {
  const lines = (doc.items || []).filter((it) => it.type !== 'title').map((it) => {
    const qty = parseNum(it.qty);
    const price = parseNum(it.price);
    const vat = company?.smallBusiness || doc.taxMode === 'reverse' ? 0 : parseNum(it.vat);
    return { ...it, qty, price, vat, net: round2(qty * price) };
  });
  const groups = {};
  for (const l of lines) {
    const g = (groups[l.vat] ||= { rate: l.vat, base: 0, tax: 0 });
    g.base = round2(g.base + l.net);
  }
  for (const g of Object.values(groups)) g.tax = round2((g.base * g.rate) / 100);
  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const tax = round2(Object.values(groups).reduce((s, g) => s + g.tax, 0));
  return { lines, groups: Object.values(groups).sort((a, b) => b.rate - a.rate), net, tax, gross: round2(net + tax) };
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function download(bytes, name, mime) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const safeFile = (s) => String(s || '').replace(/[^\w.\-äöüÄÖÜß ]+/g, '_').trim();

// Seitenränder/Positionen für PDF (mm)
export const LAYOUT_DEFAULTS = {
  marginLeft: 20,
  marginRight: 15,
  addressTop: 50, // mm von oben bis Absenderzeile
  infoTop: 75, // Kundennr./Datum rechts
  contentTop: 100, // Überschrift auf Seite 1
  followTop: 25, // Beginn auf Folgeseiten
  bottom: 30, footerBottom: 7, // Freiraum unten (Fußzeile)
  letterheadAllPages: true,
  foldMarks: true,
  logoX: 135,
  logoY: 20,
  logoW: 50,
  logoH: 25,
};

// Belegtitel inkl. Abschlags-/Schlussrechnung
export function docTitle(d) {
  if (d.isCreditNote) return 'Gutschrift';
  if (d.isStorno) return STORNO.label;
  if (d.kind === 'rechnung' && d.invoiceType === 'abschlag') return `${d.abschlagNo || 1}. Abschlagsrechnung`;
  if (d.kind === 'rechnung' && d.invoiceType === 'schluss') return 'Schlussrechnung';
  return KINDS[d.kind].pdfTitle || KINDS[d.kind].label;
}
export const shortTitle = (d) => (d.isStorno ? 'Storno' : d.kind === 'rechnung' && d.invoiceType === 'abschlag' ? `${d.abschlagNo || 1}. Abschlag` : d.kind === 'rechnung' && d.invoiceType === 'schluss' ? 'Schlussrechnung' : KINDS[d.kind].label);
