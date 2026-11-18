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
  { code: 'H87', label: 'Stk' },
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
  angebot: { label: 'Angebot', plural: 'Angebote', prefix: 'AN-{JAHR}-' },
  auftrag: { label: 'Auftrag', plural: 'Aufträge', prefix: 'AB-{JAHR}-', pdfTitle: 'Auftragsbestätigung' },
  rechnung: { label: 'Rechnung', plural: 'Rechnungen', prefix: 'RE-{JAHR}-' },
};

export const STATUS = {
  angebot: ['Entwurf', 'Versendet', 'Angenommen', 'Abgelehnt'],
  auftrag: ['Offen', 'In Arbeit', 'Erledigt'],
  rechnung: ['Entwurf', 'Versendet', 'Bezahlt', 'Storniert'],
};

// Summen nach EN 16931: Positionen auf Cent runden, Steuer je Satz auf die Summe
export function calcTotals(doc, company) {
  const lines = (doc.items || []).map((it) => {
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
  marginLeft: 25,
  marginRight: 20,
  addressTop: 50, // mm von oben bis Absenderzeile (DIN 5008 Form B ca. 45–50)
  contentTop: 100, // Beginn des Textes auf Seite 1
  followTop: 25, // Beginn auf Folgeseiten
  bottom: 30, // Freiraum unten (für Fußzeile im Briefkopf)
  letterheadAllPages: true,
};
