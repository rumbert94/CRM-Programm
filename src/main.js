import './style.css';
import * as db from './db.js';
import * as sync from './sync.js';
const buildPdf = async (...a) => (await import('./pdf.js')).buildPdf(...a);
import { buildCII, checkEInvoice } from './einvoice.js';
import {
  LAYOUT_DEFAULTS, OLD_PREFIXES, unitLabel, numberPrefix, docFileName, numberItems, esc, uid, eur, fmtDate, fmtDateTime, today, addDays, calcTotals, parseNum, UNITS, KINDS, STATUS, debounce, download, safeFile, fmtNum,
} from './util.js';

const app = document.getElementById('app');

// Darstellung: auto / hell / dunkel (pro Gerät)
const getTheme = () => {
  try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; }
};
function applyTheme(t = getTheme()) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#12161c' : '#1f4e79');
}
function setTheme(t) {
  try { localStorage.setItem('theme', t); } catch {}
  applyTheme(t);
}
const isDark = () => getTheme() === 'dark' || (getTheme() === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
applyTheme();

// Standardtexte: einzeln ein-/ausschaltbar
const textOn = (c, key) => c?.textsOn?.[key] !== false;
let companyId = localStorage.getItem('companyId') || '';

// ---------- Hilfen ----------
const company = () => db.get(companyId);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const go = (hash) => (location.hash = hash);

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => (t.classList.remove('show'), setTimeout(() => t.remove(), 300)), 3500);
}

function nextNumber(kind, c) {
  const { prefix, digits } = numberPrefix(kind, c);
  const cfg = c.numbering?.[kind] || {};
  const startApplies = !cfg.startYear || Number(cfg.startYear) === new Date().getFullYear();
  let max = startApplies ? Number(cfg.start || 1) - 1 : 0;
  for (const d of db.allRaw()) {
    if (d.type !== 'doc' || d.companyId !== c.id || d.kind !== kind || !d.number?.startsWith(prefix)) continue;
    const rest = d.number.slice(prefix.length);
    if (!/^\d+$/.test(rest)) continue;
    const n = parseInt(rest, 10);
    if (n > max) max = n;
  }
  return prefix + String(max + 1).padStart(digits, '0');
}

function nextCustomerNumber(c) {
  const prefix = c.customerPrefix ?? 'K-';
  let max = 1000;
  for (const k of db.all('customer', (x) => x.companyId === c.id)) {
    const n = parseInt(String(k.number || '').slice(prefix.length), 10);
    if (n > max) max = n;
  }
  return prefix + (max + 1);
}

const field = (label, name, value, { type = 'text', attrs = '', full = false, hint = '' } = {}) => `
  <label class="field ${full ? 'full' : ''}"><span>${esc(label)}</span>
  ${type === 'textarea'
    ? `<textarea name="${name}" rows="3" ${attrs}>${esc(value)}</textarea>`
    : `<input type="${type}" name="${name}" value="${esc(value)}" ${attrs}>`}
  ${hint ? `<small>${hint}</small>` : ''}</label>`;

const select = (label, name, value, options, attrs = '') => `
  <label class="field"><span>${esc(label)}</span><select name="${name}" ${attrs}>
  ${options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
  </select></label>`;

function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}

function customerName(id) {
  return db.get(id)?.name || '–';
}

// ---------- Rahmen ----------
function shell(content, active = '') {
  const companies = db.all('company').sort((a, b) => a.name.localeCompare(b.name));
  const s = sync.getState();
  const nav = [
    ['#/', 'Übersicht', 'home'],
    ['#/kunden', 'Kunden', 'kunden'],
    ['#/belege/angebot', 'Angebote', 'angebot'],
    ['#/belege/auftrag', 'Aufträge', 'auftrag'],
    ['#/belege/rechnung', 'Rechnungen', 'rechnung'],
    ['#/vorlagen', 'Vorlagen', 'vorlagen'],
    ['#/einstellungen', 'Einstellungen', 'settings'],
  ];
  app.innerHTML = `
  <header class="top">
    <div class="brand">Handwerk&nbsp;CRM</div>
    <select id="companySel" aria-label="Firma wählen">
      ${companies.map((c) => `<option value="${c.id}" ${c.id === companyId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      <option value="__new">+ Neue Firma …</option>
    </select>
    <button class="theme-btn" id="themeBtn" title="Hell / Dunkel umschalten" aria-label="Hell / Dunkel umschalten">${isDark() ? '☀' : '☾'}</button>
    <button class="sync ${esc(s.status)}" id="syncBtn" title="${esc(s.message)}">${syncIcon(s.status)}</button>
  </header>
  <nav class="tabs">${nav.map(([h, l, k]) => `<a href="${h}" class="${active === k ? 'active' : ''}">${l}</a>`).join('')}</nav>
  <main>${content}</main>`;
  $('#companySel').onchange = (e) => {
    if (e.target.value === '__new') return go('#/firma/neu');
    companyId = e.target.value;
    localStorage.setItem('companyId', companyId);
    route();
  };
  $('#themeBtn').onclick = (e) => {
    setTheme(isDark() ? 'light' : 'dark');
    e.currentTarget.textContent = isDark() ? '☀' : '☾';
  };
  $('#syncBtn').onclick = () => (sync.isConnected() ? sync.sync() : go('#/einstellungen'));
}

function syncIcon(status) {
  const label = { ok: '☁ ✓', 'läuft': '☁ …', fehler: '☁ !', offline: '☁ ⨯', bereit: '☁', aus: '☁ –' }[status] || '☁';
  return label;
}

// ---------- Übersicht ----------
function viewHome() {
  const c = company();
  const docs = db.all('doc', (d) => d.companyId === companyId);
  const offen = docs.filter((d) => d.kind === 'rechnung' && d.status === 'Versendet');
  const ueberfaellig = offen.filter((d) => d.dueDate && d.dueDate < today());
  const angebote = docs.filter((d) => d.kind === 'angebot' && ['Entwurf', 'Versendet'].includes(d.status));
  const auftraege = docs.filter((d) => d.kind === 'auftrag' && d.status !== 'Erledigt');
  const sum = (arr) => arr.reduce((s, d) => s + calcTotals(d, c).gross, 0);
  const recent = docs.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  shell(`
  <h1>${esc(c.name)}</h1>
  <div class="cards">
    <a class="stat" href="#/belege/rechnung?f=offen"><b>${eur(sum(offen))}</b><span>${offen.length} offene Rechnungen</span></a>
    <a class="stat ${ueberfaellig.length ? 'warn' : ''}" href="#/belege/rechnung?f=ueberfaellig"><b>${ueberfaellig.length}</b><span>überfällig</span></a>
    <a class="stat" href="#/belege/angebot"><b>${eur(sum(angebote))}</b><span>${angebote.length} offene Angebote</span></a>
    <a class="stat" href="#/belege/auftrag"><b>${auftraege.length}</b><span>laufende Aufträge</span></a>
  </div>
  <div class="actions">
    <a class="btn primary" href="#/kunde/neu">+ Kunde</a>
    <a class="btn" href="#/beleg/neu/angebot">+ Angebot</a>
    <a class="btn" href="#/beleg/neu/auftrag">+ Auftrag</a>
    <a class="btn" href="#/beleg/neu/rechnung">+ Rechnung</a>
  </div>
  <h2>Zuletzt bearbeitet</h2>
  ${docList(recent)}`, 'home');
}

function docList(docs) {
  if (!docs.length) return '<p class="empty">Noch keine Belege.</p>';
  const c = company();
  return `<ul class="list">${docs
    .map((d) => {
      const overdue = d.kind === 'rechnung' && d.status === 'Versendet' && d.dueDate && d.dueDate < today();
      return `<li><a href="#/beleg/${d.id}">
      <div><b>${esc(d.number || 'Entwurf')}</b> · ${esc(KINDS[d.kind].label)}${d.isCreditNote ? ' (Storno)' : ''}<br><small>${esc(customerName(d.customerId))} · ${esc(d.subject || '')}</small></div>
      <div class="right"><b>${eur(calcTotals(d, c).gross)}</b><br><span class="badge ${overdue ? 'warn' : esc(d.status)}">${overdue ? 'überfällig' : esc(d.status)}</span></div>
    </a></li>`;
    })
    .join('')}</ul>`;
}

// ---------- Kunden ----------
function viewCustomers() {
  const q = (sessionStorage.getItem('custQ') || '').toLowerCase();
  const list = db
    .all('customer', (k) => k.companyId === companyId)
    .filter((k) => !q || [k.name, k.contact, k.city, k.number, k.email, k.phone].join(' ').toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  shell(`
  <div class="bar"><h1>Kunden</h1><a class="btn primary" href="#/kunde/neu">+ Neuer Kunde</a></div>
  <input class="search" id="q" placeholder="Suchen (Name, Ort, Telefon …)" value="${esc(q)}">
  ${list.length ? `<ul class="list">${list.map((k) => `<li><a href="#/kunde/${k.id}"><div><b>${esc(k.name)}</b><br><small>${esc([k.number, k.zip + ' ' + k.city].filter((x) => x?.trim()).join(' · '))}</small></div><div class="right"><small>${esc(k.phone || '')}</small></div></a></li>`).join('')}</ul>` : '<p class="empty">Keine Kunden gefunden.</p>'}
  `, 'kunden');
  const qi = $('#q');
  qi.oninput = debounce(() => {
    sessionStorage.setItem('custQ', qi.value);
    viewCustomers();
    const n = $('#q');
    n.focus();
    n.setSelectionRange(n.value.length, n.value.length);
  }, 250);
}

function viewCustomer(id) {
  const isNew = id === 'neu';
  const c = company();
  const k = isNew ? { id: uid(), type: 'customer', companyId, number: nextCustomerNumber(c), country: 'DE' } : db.get(id);
  if (!k) return go('#/kunden');
  const notes = isNew ? [] : db.all('note', (n) => n.customerId === k.id).sort((a, b) => b.createdAt - a.createdAt);
  const docs = isNew ? [] : db.all('doc', (d) => d.customerId === k.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  shell(`
  <div class="bar"><h1>${isNew ? 'Neuer Kunde' : esc(k.name)}</h1>
    ${isNew ? '' : `<div class="actions"><a class="btn" href="#/beleg/neu/angebot?kunde=${k.id}">+ Angebot</a><a class="btn" href="#/beleg/neu/auftrag?kunde=${k.id}">+ Auftrag</a><a class="btn" href="#/beleg/neu/rechnung?kunde=${k.id}">+ Rechnung</a></div>`}
  </div>
  <form id="f" class="grid">
    ${field('Kundennummer', 'number', k.number)}
    ${field('Name / Firma *', 'name', k.name, { attrs: 'required' })}
    ${field('Ansprechpartner', 'contact', k.contact)}
    ${field('Straße, Nr.', 'street', k.street)}
    ${field('Adresszusatz', 'street2', k.street2)}
    ${field('PLZ', 'zip', k.zip)}
    ${field('Ort', 'city', k.city)}
    ${field('Land (ISO)', 'country', k.country || 'DE', { attrs: 'maxlength="2"' })}
    ${field('Telefon', 'phone', k.phone, { type: 'tel' })}
    ${field('Mobil', 'mobile', k.mobile, { type: 'tel' })}
    ${field('E-Mail', 'email', k.email, { type: 'email' })}
    ${field('USt-IdNr.', 'vatId', k.vatId, { hint: 'für Firmenkunden / §13b' })}
    ${field('Leitweg-ID', 'leitwegId', k.leitwegId, { hint: 'nur bei öffentlichen Auftraggebern' })}
    ${field('Info', 'info', k.info, { type: 'textarea', full: true })}
    <div class="full actions"><button class="btn primary">Speichern</button>
    ${isNew ? '' : '<button type="button" class="btn danger" id="del">Löschen</button>'}</div>
  </form>
  ${isNew ? '' : `
  <h2>Notizen</h2>
  <form id="nf" class="note-form"><textarea name="text" rows="2" placeholder="Neue Notiz, z. B. Telefonat, Aufmaß, Termin …"></textarea><button class="btn primary">Hinzufügen</button></form>
  <ul class="notes">${notes.map((n) => `<li><small>${fmtDateTime(n.createdAt)}</small><button class="link" data-del-note="${n.id}">entfernen</button><p>${esc(n.text).replace(/\n/g, '<br>')}</p></li>`).join('') || '<p class="empty">Noch keine Notizen.</p>'}</ul>
  <h2>Belege</h2>${docList(docs)}`}
  `, 'kunden');

  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    const saved = await db.put({ ...k, ...data, country: (data.country || 'DE').toUpperCase() });
    toast('Kunde gespeichert');
    if (isNew) go('#/kunde/' + saved.id);
  };
  if (!isNew) {
    $('#del').onclick = async () => {
      if (docs.length) return toast('Kunde hat Belege und kann nicht gelöscht werden.', 'err');
      if (!confirm('Kunde wirklich löschen?')) return;
      await db.remove(k.id);
      go('#/kunden');
    };
    $('#nf').onsubmit = async (e) => {
      e.preventDefault();
      const text = e.target.text.value.trim();
      if (!text) return;
      await db.put({ type: 'note', companyId, customerId: k.id, text, createdAt: Date.now() });
      viewCustomer(k.id);
    };
    $$('[data-del-note]').forEach((b) => (b.onclick = async () => {
      if (confirm('Notiz entfernen?')) {
        await db.remove(b.dataset.delNote);
        viewCustomer(k.id);
      }
    }));
  }
}

// ---------- Belege ----------
function viewDocs(kind, params) {
  const c = company();
  const f = params.get('f');
  const q = (sessionStorage.getItem('docQ' + kind) || '').toLowerCase();
  let list = db.all('doc', (d) => d.companyId === companyId && d.kind === kind);
  if (f === 'offen') list = list.filter((d) => d.status === 'Versendet');
  if (f === 'ueberfaellig') list = list.filter((d) => d.status === 'Versendet' && d.dueDate && d.dueDate < today());
  if (q) list = list.filter((d) => [d.number, d.subject, customerName(d.customerId), d.status].join(' ').toLowerCase().includes(q));
  list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || '').localeCompare(a.number || ''));
  shell(`
  <div class="bar"><h1>${KINDS[kind].plural}</h1><a class="btn primary" href="#/beleg/neu/${kind}">+ ${KINDS[kind].label}</a></div>
  <input class="search" id="q" placeholder="Suchen (Nummer, Kunde, Betreff …)" value="${esc(q)}">
  ${f ? `<p><a href="#/belege/${kind}">Filter entfernen</a></p>` : ''}
  ${docList(list)}
  <p class="sum">Summe: <b>${eur(list.reduce((s, d) => s + calcTotals(d, c).gross, 0))}</b></p>`, kind);
  const qi = $('#q');
  qi.oninput = debounce(() => {
    sessionStorage.setItem('docQ' + kind, qi.value);
    viewDocs(kind, params);
    const n = $('#q');
    n.focus();
    n.setSelectionRange(n.value.length, n.value.length);
  }, 250);
}

function newDoc(kind, fields = {}) {
  const c = company();
  const date = today();
  const d = {
    id: uid(),
    type: 'doc',
    kind,
    companyId,
    date,
    status: STATUS[kind][0],
    items: [],
    intro: textOn(c, kind + 'Intro') ? c.texts?.[kind + 'Intro'] ?? defaultIntro(kind) : '',
    outro: textOn(c, 'outro') ? c.texts?.outro ?? 'Mit freundlichen Grüßen' : '',
    ...fields,
  };
  if (kind === 'angebot') d.validUntil = addDays(date, c.offerValidDays || 30);
  if (kind === 'rechnung') {
    d.dueDate = addDays(date, c.paymentDays ?? 14);
    d.serviceDate = d.serviceDate || date;
    d.paymentTerms = paymentText(c, d.dueDate);
  } else {
    d.number = nextNumber(kind, c);
  }
  return d;
}

const defaultIntro = (kind) =>
  ({
    angebot: 'Sehr geehrte Damen und Herren,\nvielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen folgende Leistungen an:',
    auftrag: 'Sehr geehrte Damen und Herren,\nvielen Dank für Ihren Auftrag, den wir hiermit wie folgt bestätigen:',
    rechnung: 'Sehr geehrte Damen und Herren,\nfür die ausgeführten Arbeiten berechnen wir Ihnen:',
  })[kind];

const paymentText = (c, due) =>
  !textOn(c, 'paymentTerms') ? '' : (c.texts?.paymentTerms || 'Bitte überweisen Sie den Rechnungsbetrag bis zum {FAELLIG} ohne Abzug auf unser Konto.').replace('{FAELLIG}', fmtDate(due));

// Belegkette: Angebot -> Auftrag -> Rechnung
function flowHtml(d) {
  const chain = [];
  let cur = d;
  const seen = new Set();
  while (cur?.sourceId && !seen.has(cur.sourceId)) {
    seen.add(cur.sourceId);
    cur = db.get(cur.sourceId);
    if (cur) chain.unshift(cur);
  }
  chain.push(d);
  let next = d;
  for (;;) {
    const n = db.all('doc', (x) => x.sourceId === next.id && !x.isCreditNote && !String(x.subject || '').startsWith('Storno'))[0];
    if (!n || seen.has(n.id)) break;
    seen.add(n.id);
    chain.push(n);
    next = n;
  }
  if (chain.length < 2) return '';
  return `<div class="flow">${chain
    .map((x) => (x.id === d.id ? `<span class="cur">${esc(KINDS[x.kind].label)} ${esc(x.number || 'Entwurf')}</span>` : `<a href="#/beleg/${x.id}">${esc(KINDS[x.kind].label)} ${esc(x.number || 'Entwurf')}</a>`))
    .join(' → ')}</div>`;
}

function convert(src, kind) {
  return newDoc(kind, {
    customerId: src.customerId,
    subject: src.subject,
    items: structuredClone(src.items || []).map((i) => ({ ...i, id: uid() })),
    taxMode: src.taxMode,
    orderReference: src.orderReference,
    sourceId: src.id,
    sourceNumber: src.number,
  });
}

async function viewDoc(id, params, kindForNew) {
  const c = company();
  let d;
  if (id === 'neu') {
    d = newDoc(kindForNew, { customerId: params.get('kunde') || '' });
  } else {
    d = db.get(id);
    if (!d) return go('#/');
    if (d.companyId !== companyId) {
      companyId = d.companyId;
      localStorage.setItem('companyId', companyId);
    }
  }
  const isNew = id === 'neu';
  const locked = !!d.locked;
  const customers = db.all('customer', (k) => k.companyId === companyId).sort((a, b) => a.name.localeCompare(b.name));
  const kind = KINDS[d.kind];
  const dis = locked ? 'disabled' : '';
  const reverseAllowed = !c.smallBusiness;

  shell(`
  <div class="bar"><h1>${d.isCreditNote ? 'Storno' : kind.label} ${d.number ? 'Nr. ' + esc(d.number) : '(Entwurf)'}</h1>
    <span><span class="badge ${esc(d.status)}">${esc(d.status)}</span>${locked ? ' <span class="badge einv">✓ E-Rechnung (ZUGFeRD)</span>' : ''}</span></div>
  ${flowHtml(d)}
  ${locked ? `<p class="info">Diese Rechnung ist abgeschlossen und kann nicht mehr geändert werden (GoBD). Für Korrekturen bitte stornieren.</p>` : ''}
  <form id="f" class="grid">
    <label class="field"><span>Kunde *</span><select name="customerId" ${dis} required>
      <option value="">– bitte wählen –</option>
      ${customers.map((k) => `<option value="${k.id}" ${k.id === d.customerId ? 'selected' : ''}>${esc(k.name)}${k.city ? ' (' + esc(k.city) + ')' : ''}</option>`).join('')}
    </select><small><a href="#/kunde/neu">+ neuen Kunden anlegen</a></small></label>
    ${field('Datum', 'date', d.date, { type: 'date', attrs: dis })}
    ${d.kind === 'angebot' ? field('Gültig bis', 'validUntil', d.validUntil, { type: 'date', attrs: dis }) : ''}
    ${d.kind !== 'angebot' ? select('Leistung', 'serviceMode', d.serviceMode || 'date', [{ value: 'date', label: 'Leistungsdatum' }, { value: 'period', label: 'Leistungszeitraum' }], dis + ' id="serviceMode"') : ''}
    ${d.kind !== 'angebot' ? `<span class="svc-date" ${d.serviceMode === 'period' ? 'hidden' : ''}>${field('Leistungsdatum', 'serviceDate', d.serviceDate, { type: 'date', attrs: dis })}</span>
      <span class="svc-period" ${d.serviceMode === 'period' ? '' : 'hidden'}>${field('Leistung von', 'serviceFrom', d.serviceFrom, { type: 'date', attrs: dis })}</span>
      <span class="svc-period" ${d.serviceMode === 'period' ? '' : 'hidden'}>${field('Leistung bis', 'serviceTo', d.serviceTo, { type: 'date', attrs: dis })}</span>` : ''}
    ${d.kind === 'rechnung' ? field('Fällig am', 'dueDate', d.dueDate, { type: 'date', attrs: dis }) : ''}
    ${select('Status', 'status', d.status, STATUS[d.kind].map((s) => ({ value: s, label: s })))}
    ${field('Betreff / Bauvorhaben (mehrzeilig möglich)', 'subject', d.subject, { type: 'textarea', full: true, attrs: dis })}
    ${field('Bestellnummer des Kunden', 'orderReference', d.orderReference, { attrs: dis })}
    ${reverseAllowed ? select('Umsatzsteuer', 'taxMode', d.taxMode || 'normal', [{ value: 'normal', label: 'normal' }, { value: 'reverse', label: '§13b – Kunde schuldet USt (Bauleistung)' }], dis) : '<p class="muted">Kleinunternehmer: keine USt.</p>'}
    ${d.kind === 'rechnung' ? field('Bereits gezahlt / Anzahlung (€)', 'prepaid', d.prepaid ? fmtNum(d.prepaid) : '', { attrs: dis + ' inputmode="decimal"' }) : ''}
    ${field('Einleitung', 'intro', d.intro, { type: 'textarea', full: true, attrs: dis })}
  </form>

  <h2>Positionen</h2>
  <div id="items"></div>
  ${locked ? '' : '<div class="actions"><button class="btn" id="addItem">+ Position</button><button class="btn" id="addTitle">+ Titel</button><button class="btn" id="fromTpl">+ Aus Vorlagen</button></div>'}
  <div id="totals" class="totals"></div>

  <form id="f2" class="grid">
    ${d.kind === 'rechnung' ? field('Zahlungsbedingungen', 'paymentTerms', d.paymentTerms, { type: 'textarea', full: true, attrs: dis }) : ''}
    ${field('Schlusstext', 'outro', d.outro, { type: 'textarea', full: true, attrs: dis })}
  </form>

  <div class="actions sticky">
    ${d.kind === 'rechnung' && d.locked
      ? '<button class="btn primary" id="zugferd">E-Rechnung (PDF) herunterladen</button><button class="btn" id="pdf">Ansehen</button><button class="btn" id="xrechnung">XRechnung (nur XML, für Behörden)</button>'
      : `<button class="btn" id="pdf">${d.kind === 'rechnung' ? 'Vorschau (Entwurf)' : 'PDF ansehen'}</button>`}
    ${d.kind === 'rechnung' && !d.locked ? '<button class="btn primary" id="finalize">Rechnung abschließen</button>' : ''}
    ${d.kind === 'angebot' ? '<button class="btn primary" id="toAuftrag">In Auftrag überführen →</button><button class="btn" id="toRechnung">Direkt in Rechnung →</button>' : ''}
    ${d.kind === 'auftrag' ? '<button class="btn primary" id="toRechnung">In Rechnung überführen →</button>' : ''}
    ${!d.isCreditNote && d.kind === 'rechnung' && d.locked && d.status !== 'Storniert' ? '<button class="btn danger" id="storno">Stornieren</button>' : ''}
    ${!d.locked ? '<button class="btn danger" id="del">Löschen</button>' : ''}
    <button class="btn" id="copy">Kopieren</button>
  </div>
  <p class="muted" id="saveState"></p>`, d.kind);

  const save = async () => {
    Object.assign(d, formData($('#f')), formData($('#f2')));
    d.prepaid = parseNum(d.prepaid);
    if (!d.customerId) {
      $('#saveState').textContent = 'Bitte Kunde wählen – noch nicht gespeichert.';
      return false;
    }
    await db.put(d, { silent: true });
    sync.scheduleSync();
    if (location.hash.includes('/neu/')) history.replaceState(null, '', '#/beleg/' + d.id);
    $('#saveState').textContent = 'Gespeichert ' + new Date().toLocaleTimeString('de-DE');
    return true;
  };
  const autosave = debounce(save, 700);

  const tools = (i) => locked ? '' : `<span class="item-tools"><button class="link" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="nach oben">▲</button><button class="link" data-down="${i}" ${i === d.items.length - 1 ? 'disabled' : ''} title="nach unten">▼</button>${d.items[i].type === 'title' ? '' : `<button class="link" data-tpl="${i}" title="Als Vorlage speichern">☆ Vorlage</button>`}<button class="link danger" data-rm="${i}" title="entfernen">✕</button></span>`;
  const renderItems = () => {
    const box = $('#items');
    const nums = numberItems(d.items);
    box.innerHTML = d.items.length
      ? d.items.map((it, i) => it.type === 'title' ? `
      <div class="item title-item" data-i="${i}">
        <div class="item-head"><b>Titel ${nums[i].pos}</b>${tools(i)}</div>
        <input data-k="title" placeholder="Titel, z. B. Abbrucharbeiten" value="${esc(it.title)}" ${dis}>
      </div>` : `
      <div class="item" data-i="${i}">
        <div class="item-head"><b>Pos. ${nums[i].pos}</b>${tools(i)}</div>
        <input data-k="title" placeholder="Kurztext (optional, wird fett gedruckt)" value="${esc(it.title)}" ${dis}>
        <textarea data-k="desc" rows="3" placeholder="Beschreibung" ${dis}>${esc(it.desc)}</textarea>
        <div class="item-row">
          <label>Menge<input data-k="qty" inputmode="decimal" value="${esc(String(it.qty ?? '').replace('.', ','))}" ${dis}></label>
          <label>Einheit<select data-k="unit" ${dis}>${UNITS.map((u) => `<option value="${u.code}" ${u.code === it.unit ? 'selected' : ''}>${u.label}</option>`).join('')}</select></label>
          <label>Einzelpreis €<input data-k="price" inputmode="decimal" value="${esc(String(it.price ?? '').replace('.', ','))}" ${dis}></label>
          ${c.smallBusiness ? '' : `<label>USt<select data-k="vat" ${dis}>${[19, 7, 0].map((v) => `<option value="${v}" ${Number(it.vat) === v ? 'selected' : ''}>${v} %</option>`).join('')}</select></label>`}
          <div class="line-total">${eur(calcTotals({ items: [it] }, c).net)}</div>
        </div>
      </div>`).join('')
      : '<p class="empty">Noch keine Positionen.</p>';
    renderTotals();
  };
  const renderTotals = () => {
    const t = calcTotals(d, c);
    $('#totals').innerHTML = `<div><span>Netto</span><b>${eur(t.net)}</b></div>
      ${t.groups.filter((g) => g.rate > 0).map((g) => `<div><span>USt ${fmtNum(g.rate)} %</span><b>${eur(g.tax)}</b></div>`).join('')}
      <div class="grand"><span>Gesamt</span><b>${eur(t.gross)}</b></div>`;
  };
  renderItems();

  if (!locked) {
    $('#items').addEventListener('input', (e) => {
      const el = e.target;
      const i = el.closest('.item')?.dataset.i;
      if (i === undefined || !el.dataset.k) return;
      d.items[i][el.dataset.k] = el.dataset.k === 'qty' || el.dataset.k === 'price' || el.dataset.k === 'vat' ? (el.dataset.k === 'vat' ? Number(el.value) : el.value) : el.value;
      const lt = el.closest('.item').querySelector('.line-total');
      if (lt) lt.textContent = eur(calcTotals({ items: [d.items[i]] }, c).net);
      renderTotals();
      autosave();
    });
    $('#items').addEventListener('change', (e) => e.target.tagName === 'SELECT' && e.target.dispatchEvent(new Event('input', { bubbles: true })));
    $('#items').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      const mv = (from, to) => d.items.splice(to, 0, d.items.splice(from, 1)[0]);
      if (b.dataset.tpl !== undefined) {
        const it = d.items[Number(b.dataset.tpl)];
        if (!(it.title || it.desc)) return toast('Position ist leer.', 'err');
        saveTemplate(it);
        return;
      }
      if (b.dataset.rm !== undefined) d.items.splice(Number(b.dataset.rm), 1);
      if (b.dataset.up !== undefined) mv(Number(b.dataset.up), Number(b.dataset.up) - 1);
      if (b.dataset.down !== undefined) mv(Number(b.dataset.down), Number(b.dataset.down) + 1);
      renderItems();
      autosave();
    });
    $('#addTitle').onclick = () => {
      d.items.push({ id: uid(), type: 'title', title: '' });
      renderItems();
      $$('#items .item').at(-1).querySelector('input').focus();
    };
    $('#fromTpl').onclick = () =>
      pickTemplate((tpl) => {
        d.items.push({ id: uid(), title: tpl.title || '', desc: tpl.desc || '', qty: '1', unit: tpl.unit || 'H87', price: tpl.price ?? '', vat: tpl.vat ?? c.defaultVat ?? 19 });
        db.put({ ...tpl, usage: (tpl.usage || 0) + 1 }, { silent: true });
        renderItems();
        autosave();
      });
    $('#addItem').onclick = () => {
      d.items.push({ id: uid(), title: '', desc: '', qty: '1', unit: 'H87', price: '', vat: c.defaultVat ?? 19 });
      renderItems();
      $$('#items .item').at(-1).querySelector('input').focus();
    };
  }
  for (const f of ['#f', '#f2']) {
    $(f).addEventListener('input', autosave);
    $(f).addEventListener('change', autosave);
    $(f).onsubmit = (e) => e.preventDefault();
  }
  $('[name=dueDate]')?.addEventListener('change', (e) => {
    const pt = $('[name=paymentTerms]');
    if (pt && !locked) pt.value = paymentText(c, e.target.value);
  });

  const customer = () => d.customerSnapshot || db.get(d.customerId);
  const fileBase = () => safeFile(docFileName(d));
  $('#serviceMode')?.addEventListener('change', (e) => {
    const p = e.target.value === 'period';
    $$('.svc-period').forEach((x) => (x.hidden = !p));
    $$('.svc-date').forEach((x) => (x.hidden = p));
  });

  $('#pdf').onclick = async () => {
    if (!(await save())) return;
    try {
      const bytes = await buildPdf(d, d.locked ? companyForDoc() : c, customer(), { zugferd: !!d.locked });
      openPdf(bytes, fileBase() + '.pdf');
    } catch (e) {
      console.error(e);
      toast('PDF-Fehler: ' + e.message, 'err');
    }
  };
  const convertTo = (kind) => async () => {
    if (!(await save())) return;
    const n = convert(d, kind);
    await db.put(n);
    if (d.kind === 'angebot') await db.put({ ...d, status: 'Angenommen' });
    if (d.kind === 'auftrag') await db.put({ ...d, status: 'Erledigt' });
    toast(`${KINDS[kind].label} erstellt`);
    go('#/beleg/' + n.id);
  };
  $('#toAuftrag') && ($('#toAuftrag').onclick = convertTo('auftrag'));
  $('#toRechnung') && ($('#toRechnung').onclick = convertTo('rechnung'));
  $('#copy') && ($('#copy').onclick = async () => {
    if (!(await save())) return;
    const n = newDoc(d.kind, { customerId: d.customerId, subject: d.subject, items: structuredClone(d.items).map((i) => ({ ...i, id: uid() })), taxMode: d.taxMode });
    await db.put(n);
    go('#/beleg/' + n.id);
  });
  $('#del') && ($('#del').onclick = async () => {
    if (!confirm('Beleg wirklich löschen?')) return;
    if (db.get(d.id)) await db.remove(d.id);
    go('#/belege/' + d.kind);
  });
  $('#finalize') && ($('#finalize').onclick = async () => {
    if (!(await save())) return;
    if (!d.items.length) return toast('Bitte mindestens eine Position erfassen.', 'err');
    const k = db.get(d.customerId);
    const problems = checkEInvoice({ ...d, number: 'x' }, c, k, 'zugferd');
    if (problems.length && !confirm('Für eine gültige E-Rechnung fehlt noch:\n• ' + problems.join('\n• ') + '\n\nTrotzdem abschließen?')) return;
    if (!confirm('Rechnung jetzt abschließen? Danach erhält sie eine feste Nummer und kann nicht mehr geändert werden.')) return;
    d.number = nextNumber('rechnung', c);
    d.locked = true;
    d.lockedAt = Date.now();
    d.status = 'Versendet';
    d.customerSnapshot = { ...k };
    d.companySnapshot = { ...c };
    await db.put(d);
    toast('Rechnung ' + d.number + ' abgeschlossen');
    viewDoc(d.id, params);
  });
  const companyForDoc = () => ({ ...(d.companySnapshot || {}), ...c, letterheadFileId: c.letterheadFileId });
  $('#zugferd') && ($('#zugferd').onclick = async () => {
    const problems = checkEInvoice(d, companyForDoc(), customer(), 'zugferd');
    if (problems.length) toast('Hinweis: ' + problems.join(', '), 'err');
    try {
      const bytes = await buildPdf(d, companyForDoc(), customer(), { zugferd: true });
      const name = fileBase() + '.pdf';
      await offerArchive(bytes, name, 'application/pdf');
      download(bytes, name, 'application/pdf');
    } catch (e) {
      console.error(e);
      toast('Fehler: ' + e.message, 'err');
    }
  });
  $('#xrechnung') && ($('#xrechnung').onclick = async () => {
    const problems = checkEInvoice(d, companyForDoc(), customer(), 'xrechnung');
    if (problems.length && !confirm('Für XRechnung fehlt:\n• ' + problems.join('\n• ') + '\n\nTrotzdem erzeugen?')) return;
    const xml = buildCII(d, companyForDoc(), customer(), 'xrechnung');
    const name = fileBase() + '.xml';
    await offerArchive(new TextEncoder().encode(xml), name, 'application/xml');
    download(xml, name, 'application/xml');
  });
  $('#storno') && ($('#storno').onclick = async () => {
    if (!confirm(`Rechnung ${d.number} stornieren? Es wird eine Stornorechnung mit negativen Beträgen erstellt.`)) return;
    const s = newDoc('rechnung', {
      customerId: d.customerId,
      subject: `Storno zu Rechnung ${d.number} vom ${fmtDate(d.date)}`,
      items: d.items.map((i) => ({ ...i, id: uid(), qty: -parseNum(i.qty) })),
      taxMode: d.taxMode,
      sourceId: d.id,
      sourceNumber: d.number,
      serviceDate: d.serviceDate,
      isCreditNote: false,
      intro: `Hiermit stornieren wir unsere Rechnung ${d.number} vom ${fmtDate(d.date)}.`,
      paymentTerms: '',
    });
    await db.put({ ...d, status: 'Storniert' });
    await db.put(s);
    go('#/beleg/' + s.id);
  });
}

async function offerArchive(bytes, name, mime) {
  if (!sync.isConnected()) return;
  try {
    const path = await sync.archive(company().name, name, bytes, mime);
    toast('In OneDrive abgelegt: ' + path);
  } catch (e) {
    toast(e.message, 'err');
  }
}

function openPdf(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) download(blob, name);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function textField(c, label, key, name, value, hint = '') {
  const on = textOn(c, key);
  return `<div class="field full ${on ? '' : 'off'}" data-textfield>
    <div class="switch-row"><span>${esc(label)}</span>
      <label class="switch"><input type="checkbox" name="textsOn.${key}" ${on ? 'checked' : ''}><span class="track"></span><span class="sw-label">${on ? 'ein' : 'aus'}</span></label></div>
    <textarea name="${name}" rows="3">${esc(value)}</textarea>
    ${hint ? `<small>${hint}</small>` : ''}
  </div>`;
}

// ---------- Positionsvorlagen ----------
async function saveTemplate(it) {
  const dup = db.all('article', (a) => a.companyId === companyId && a.title === it.title && a.desc === it.desc);
  const base = dup[0] || { type: 'article', companyId, usage: 0 };
  await db.put({ ...base, title: it.title || '', desc: it.desc || '', unit: it.unit || 'H87', price: parseNum(it.price), vat: Number(it.vat ?? 19) });
  toast(dup.length ? 'Vorlage aktualisiert' : 'Als Vorlage gespeichert');
}

const tplMatches = (a, q) => !q || [a.title, a.desc].join(' ').toLowerCase().includes(q.toLowerCase());
const tplLabel = (a) => a.title || (a.desc || '').split('\n')[0].slice(0, 80);

function pickTemplate(onPick) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet"><div class="bar"><h2>Vorlage einfügen</h2><button class="link" data-close>Schließen</button></div>
    <input class="search" placeholder="Suchen …" id="tplQ"><ul class="list" id="tplList"></ul></div>`;
  document.body.appendChild(ov);
  const all = db.all('article', (a) => a.companyId === companyId).sort((a, b) => (b.usage || 0) - (a.usage || 0) || tplLabel(a).localeCompare(tplLabel(b)));
  const render = (q) => {
    const list = all.filter((a) => tplMatches(a, q));
    $('#tplList', ov).innerHTML = list.length
      ? list.map((a) => `<li><a href="javascript:void 0" data-id="${a.id}"><div><b>${esc(tplLabel(a))}</b><br><small>${esc((a.title ? a.desc : '') || '').slice(0, 120)}</small></div><div class="right">${eur(a.price)}<br><small>je ${esc(unitLabel(a.unit))}</small></div></a></li>`).join('')
      : '<li class="empty" style="padding:1rem">Keine Vorlagen gefunden. Speichere Positionen mit „☆ Vorlage“.</li>';
  };
  render('');
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-close]')) return close();
    const a = e.target.closest('[data-id]');
    if (a) {
      onPick(db.get(a.dataset.id));
      close();
      toast('Position eingefügt');
    }
  });
  $('#tplQ', ov).oninput = (e) => render(e.target.value);
  $('#tplQ', ov).focus();
}

function viewTemplates() {
  const q = sessionStorage.getItem('tplQ') || '';
  const list = db
    .all('article', (a) => a.companyId === companyId)
    .filter((a) => tplMatches(a, q))
    .sort((a, b) => tplLabel(a).localeCompare(tplLabel(b)));
  const editId = sessionStorage.getItem('tplEdit');
  const ed = editId === 'neu' ? { type: 'article', companyId, unit: 'H87', vat: company().defaultVat ?? 19 } : editId ? db.get(editId) : null;
  shell(`
  <div class="bar"><h1>Positionsvorlagen</h1><button class="btn primary" id="newTpl">+ Neue Vorlage</button></div>
  <p class="muted">Häufige Leistungen hier ablegen oder im Beleg bei einer Position auf „☆ Vorlage“ tippen. Im Beleg fügst du sie mit „+ Aus Vorlagen“ ein.</p>
  ${ed ? `<form id="tf" class="grid card">
    ${field('Kurztext (fett)', 'title', ed.title, { full: true })}
    ${field('Beschreibung', 'desc', ed.desc, { type: 'textarea', full: true })}
    ${select('Einheit', 'unit', ed.unit, UNITS.map((u) => ({ value: u.code, label: u.label })))}
    ${field('Einzelpreis netto €', 'price', ed.price != null ? String(ed.price).replace('.', ',') : '', { attrs: 'inputmode="decimal"' })}
    ${select('USt', 'vat', ed.vat ?? 19, [19, 7, 0].map((v) => ({ value: v, label: v + ' %' })))}
    <div class="actions full"><button class="btn primary">Speichern</button><button type="button" class="btn" id="tplCancel">Abbrechen</button>${ed.id ? '<button type="button" class="btn danger" id="tplDel">Löschen</button>' : ''}</div>
  </form>` : ''}
  <input class="search" id="q" placeholder="Vorlagen suchen …" value="${esc(q)}">
  ${list.length ? `<ul class="list">${list.map((a) => `<li><a href="javascript:void 0" data-edit="${a.id}"><div><b>${esc(tplLabel(a))}</b><br><small>${esc((a.title ? a.desc : '') || '').slice(0, 140)}</small></div><div class="right">${eur(a.price)}<br><small>je ${esc(unitLabel(a.unit))}</small></div></a></li>`).join('')}</ul>` : '<p class="empty">Noch keine Vorlagen.</p>'}
  `, 'vorlagen');
  const reopen = (id) => {
    if (id) sessionStorage.setItem('tplEdit', id);
    else sessionStorage.removeItem('tplEdit');
    viewTemplates();
  };
  $('#newTpl').onclick = () => reopen('neu');
  $$('[data-edit]').forEach((a) => (a.onclick = () => reopen(a.dataset.edit)));
  if (ed) {
    $('#tf').onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      await db.put({ ...ed, ...f, price: parseNum(f.price), vat: Number(f.vat) });
      toast('Vorlage gespeichert');
      reopen(null);
    };
    $('#tplCancel').onclick = () => reopen(null);
    $('#tplDel') && ($('#tplDel').onclick = async () => {
      if (!confirm('Vorlage löschen?')) return;
      await db.remove(ed.id);
      reopen(null);
    });
  }
  const qi = $('#q');
  qi.oninput = debounce(() => {
    sessionStorage.setItem('tplQ', qi.value);
    viewTemplates();
    const n = $('#q');
    n.focus();
    n.setSelectionRange(n.value.length, n.value.length);
  }, 250);
}

// ---------- Firma ----------
async function viewCompany(id) {
  const isNew = id === 'neu';
  const c = isNew
    ? { id: uid(), type: 'company', country: 'DE', paymentDays: 14, defaultVat: 19, layout2: { ...LAYOUT_DEFAULTS } }
    : db.get(id);
  if (!c) return go('#/einstellungen');
  const L = { ...LAYOUT_DEFAULTS, ...(c.layout2 || {}) };
  const lh = c.letterheadFileId ? await db.getFile(c.letterheadFileId) : null;
  const logoF = c.logoFileId ? await db.getFile(c.logoFileId) : null;
  const pfx = (k) => {
    const v = n[k]?.prefix;
    return !v || OLD_PREFIXES.includes(v) ? KINDS[k].prefix : v;
  };
  const n = c.numbering || {};
  const t = c.texts || {};
  shell(`
  <h1>${isNew ? 'Neue Firma' : esc(c.name)}</h1>
  <form id="f">
    <h2>Stammdaten</h2>
    <div class="grid">
      ${field('Firmenname *', 'name', c.name, { attrs: 'required' })}
      ${field('Inhaber / Geschäftsführer', 'owner', c.owner)}
      ${field('Straße, Nr. *', 'street', c.street)}
      ${field('PLZ *', 'zip', c.zip)}
      ${field('Ort *', 'city', c.city)}
      ${field('Land (ISO)', 'country', c.country || 'DE', { attrs: 'maxlength="2"' })}
      ${field('Ansprechpartner (E-Rechnung)', 'contactName', c.contactName)}
      ${field('Telefon', 'phone', c.phone, { type: 'tel' })}
      ${field('E-Mail', 'email', c.email, { type: 'email' })}
      ${field('Webseite', 'web', c.web)}
      ${field('Steuernummer', 'taxNumber', c.taxNumber)}
      ${field('USt-IdNr.', 'vatId', c.vatId)}
      ${field('Handelsregister / HWK', 'register', c.register, { hint: 'z. B. „Amtsgericht X HRB 123“ oder „Handwerkskammer X“' })}
      <label class="field check"><input type="checkbox" name="smallBusiness" ${c.smallBusiness ? 'checked' : ''}><span>Kleinunternehmer (§ 19 UStG)</span></label>
    </div>
    <h2>Bank</h2>
    <div class="grid">
      ${field('Bank', 'bankName', c.bankName)}
      ${field('IBAN', 'iban', c.iban)}
      ${field('BIC', 'bic', c.bic)}
      ${field('Kontoinhaber (falls abweichend)', 'accountHolder', c.accountHolder)}
    </div>
    <h2>Logo & Fußzeile</h2>
    <p class="muted">Lade dein Logo hoch (PNG oder JPG). Es steht oben rechts auf der ersten Seite. Die Fußzeile wird aus deinen Stammdaten erzeugt oder du schreibst sie selbst (eine Zeile pro Zeile).</p>
    <div class="letterhead">
      ${logoF ? `<p>Logo: <b>${esc(logoF.name)}</b> <button type="button" class="link danger" id="logoRemove">entfernen</button></p>` : '<p>Kein Logo hinterlegt.</p>'}
      <input type="file" id="logoFile" accept="image/png,image/jpeg">
    </div>
    <div class="grid">
      ${field('Logo links (mm)', 'layout2.logoX', L.logoX, { type: 'number' })}
      ${field('Logo oben (mm)', 'layout2.logoY', L.logoY, { type: 'number' })}
      ${field('Logo Breite (mm)', 'layout2.logoW', L.logoW, { type: 'number' })}
      ${field('Logo Höhe (mm)', 'layout2.logoH', L.logoH, { type: 'number' })}
      ${field('Zusatz in der Fußzeile', 'footerExtra', c.footerExtra, { hint: 'z. B. „Meisterbetrieb“' })}
      ${field('Fußzeile (frei, optional)', 'footerText', c.footerText, { type: 'textarea', full: true, hint: 'leer = automatisch: Firma • Inhaber • Adresse / Bank • IBAN • BIC • USt-ID / Tel. • Mail • Web' })}
    </div>
    <h2>Briefbogen (Alternative zu Logo & Fußzeile)</h2>
    <p class="muted">Hast du einen fertigen Briefbogen als PDF (Seite 2 = Folgeseite) oder Bild, kannst du ihn hier hinterlegen. Dann werden Logo und Fußzeile von oben nicht gedruckt.</p>
    <div class="letterhead">
      ${lh ? `<p>Aktuell: <b>${esc(lh.name)}</b> <button type="button" class="link danger" id="lhRemove">entfernen</button></p>` : '<p>Kein Briefbogen hinterlegt.</p>'}
      <input type="file" id="lhFile" accept="application/pdf,image/png,image/jpeg">
    </div>
    <h2>Seitenaufbau</h2>
    <div class="grid">
      ${field('Absenderzeile über der Anschrift', 'senderLine', c.senderLine, { full: true, hint: 'leer = automatisch, z. B. „Firma • Straße • PLZ Ort“' })}
      ${field('Absenderzeile ab (mm von oben)', 'layout2.addressTop', L.addressTop, { type: 'number' })}
      ${field('Kundennr./Datum ab (mm)', 'layout2.infoTop', L.infoTop, { type: 'number' })}
      ${field('Überschrift ab (mm)', 'layout2.contentTop', L.contentTop, { type: 'number' })}
      ${field('Folgeseiten beginnen ab (mm)', 'layout2.followTop', L.followTop, { type: 'number' })}
      ${field('Rand unten frei (mm)', 'layout2.bottom', L.bottom, { type: 'number' })}
      ${field('Rand links (mm)', 'layout2.marginLeft', L.marginLeft, { type: 'number' })}
      ${field('Rand rechts (mm)', 'layout2.marginRight', L.marginRight, { type: 'number' })}
      <label class="field check"><input type="checkbox" name="layout2.foldMarks" ${L.foldMarks ? 'checked' : ''}><span>Falz- und Lochmarken</span></label>
      <label class="field check"><input type="checkbox" name="layout2.letterheadAllPages" ${L.letterheadAllPages ? 'checked' : ''}><span>Briefbogen auf allen Seiten</span></label>
    </div>
    <h2>Nummern & Vorgaben</h2>
    <div class="grid">
      ${field('Rechnungsnummer: Vorsatz', 'numbering.rechnung.prefix', pfx('rechnung'), { hint: '{JJ} = Jahr zweistellig (26), {JAHR} = 2026' })}
      ${field('Rechnungsnummer: Stellen der lfd. Nr.', 'numbering.rechnung.digits', n.rechnung?.digits ?? KINDS.rechnung.digits, { type: 'number', hint: `nächste Rechnung: <b>${esc(isNew ? '' : nextNumber('rechnung', c))}</b>` })}
      ${field('Nächste lfd. Rechnungsnr. in diesem Jahr', 'numbering.rechnung.start', n.rechnung?.startYear == new Date().getFullYear() ? n.rechnung?.start ?? '' : '', { type: 'number', hint: 'z. B. 9 → 2609, wenn du bisher bis 2608 geschrieben hast' })}
      ${field('Angebotsnummer: Vorsatz', 'numbering.angebot.prefix', pfx('angebot'))}
      ${field('Angebotsnummer: Stellen', 'numbering.angebot.digits', n.angebot?.digits ?? KINDS.angebot.digits, { type: 'number' })}
      ${field('Auftragsnummer: Vorsatz', 'numbering.auftrag.prefix', pfx('auftrag'))}
      ${field('Auftragsnummer: Stellen', 'numbering.auftrag.digits', n.auftrag?.digits ?? KINDS.auftrag.digits, { type: 'number' })}
      ${field('Präfix Kundennummer', 'customerPrefix', c.customerPrefix ?? 'K-')}
      ${field('Zahlungsziel (Tage)', 'paymentDays', c.paymentDays ?? 14, { type: 'number' })}
      ${field('Angebot gültig (Tage)', 'offerValidDays', c.offerValidDays ?? 30, { type: 'number' })}
      ${select('Standard-USt.', 'defaultVat', c.defaultVat ?? 19, [{ value: 19, label: '19 %' }, { value: 7, label: '7 %' }, { value: 0, label: '0 %' }])}
    </div>
    <h2>Standardtexte</h2>
    <p class="muted">Mit dem Schalter legst du fest, ob ein Text automatisch in neue Belege übernommen wird.</p>
    <div class="grid">
      ${textField(c, 'Einleitung Angebot', 'angebotIntro', 'texts.angebotIntro', t.angebotIntro ?? defaultIntro('angebot'))}
      ${textField(c, 'Einleitung Auftrag', 'auftragIntro', 'texts.auftragIntro', t.auftragIntro ?? defaultIntro('auftrag'))}
      ${textField(c, 'Einleitung Rechnung', 'rechnungIntro', 'texts.rechnungIntro', t.rechnungIntro ?? defaultIntro('rechnung'))}
      ${textField(c, 'Zahlungsbedingungen', 'paymentTerms', 'texts.paymentTerms', t.paymentTerms ?? 'Bitte überweisen Sie den Rechnungsbetrag bis zum {FAELLIG} ohne Abzug auf unser Konto.', '{FAELLIG} wird durch das Fälligkeitsdatum ersetzt')}
      ${textField(c, 'Schlusstext', 'outro', 'texts.outro', t.outro ?? 'Mit freundlichen Grüßen')}
      ${textField(c, 'Hinweis auf Rechnungen an Privatkunden', 'privateNotice', 'privateNotice', c.privateNotice ?? 'Bei Leistungen an einem Grundstück: Sie sind gesetzlich verpflichtet, diese Rechnung zwei Jahre aufzubewahren (§ 14b UStG).', 'wird nur gedruckt, wenn der Kunde keine USt-IdNr. hat')}
    </div>
    <div class="actions sticky"><button class="btn primary">Speichern</button>
      <button type="button" class="btn" id="preview">Probe-PDF (nur Layout, keine E-Rechnung)</button>
      ${isNew ? '' : '<button type="button" class="btn danger" id="del">Firma löschen</button>'}</div>
  </form>`, 'settings');

  const collect = () => {
    const data = formData($('#f'));
    const out = { ...c, layout2: { ...L }, numbering: structuredClone(c.numbering || {}), texts: { ...(c.texts || {}) }, textsOn: { ...(c.textsOn || {}) } };
    for (const [k, v] of Object.entries(data)) {
      const parts = k.split('.');
      let o = out;
      while (parts.length > 1) o = o[parts[0]] ||= {}, parts.shift();
      o[parts[0]] = v;
    }
    for (const [k, v] of Object.entries(LAYOUT_DEFAULTS)) if (typeof v === 'number') out.layout2[k] = Number(out.layout2[k]);
    for (const k of Object.keys(KINDS)) {
      const nk = (out.numbering[k] ||= {});
      nk.digits = Number(nk.digits) || KINDS[k].digits;
    }
    const st = out.numbering.rechnung;
    if (st.start) {
      st.start = Number(st.start);
      st.startYear = new Date().getFullYear();
    }
    out.paymentDays = Number(out.paymentDays);
    out.offerValidDays = Number(out.offerValidDays);
    out.defaultVat = Number(out.defaultVat);
    out.country = (out.country || 'DE').toUpperCase();
    return out;
  };

  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const saved = await db.put(collect());
    if (isNew || !companyId) {
      companyId = saved.id;
      localStorage.setItem('companyId', companyId);
    }
    toast('Firma gespeichert');
    go('#/einstellungen');
  };
  $('#lhFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return toast('Datei zu groß (max. 8 MB)', 'err');
    const f = await db.putFile({ name: file.name, mime: file.type, data: file });
    const saved = await db.put({ ...collect(), letterheadFileId: f.id });
    if (!companyId) companyId = saved.id;
    toast('Briefkopf gespeichert');
    viewCompany(saved.id);
  };
  $$('[data-textfield] .switch input').forEach((cb) =>
    cb.addEventListener('change', () => {
      cb.closest('[data-textfield]').classList.toggle('off', !cb.checked);
      cb.parentElement.querySelector('.sw-label').textContent = cb.checked ? 'ein' : 'aus';
    })
  );
  $('#logoFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) return toast('Datei zu groß (max. 4 MB)', 'err');
    const f = await db.putFile({ name: file.name, mime: file.type, data: file });
    const saved = await db.put({ ...collect(), logoFileId: f.id });
    if (!companyId) companyId = saved.id;
    toast('Logo gespeichert');
    viewCompany(saved.id);
  };
  $('#logoRemove') && ($('#logoRemove').onclick = async () => {
    await db.put({ ...collect(), logoFileId: null });
    viewCompany(c.id);
  });
  $('#lhRemove') && ($('#lhRemove').onclick = async () => {
    await db.put({ ...collect(), letterheadFileId: null });
    viewCompany(c.id);
  });
  $('#preview').onclick = async () => {
    const cc = collect();
    const demo = {
      kind: 'rechnung', number: nextNumber('rechnung', { ...cc, id: c.id }), date: today(), serviceDate: today(), dueDate: addDays(today(), cc.paymentDays),
      subject: 'Musterrechnung zur Layoutprüfung', intro: cc.texts.rechnungIntro, outro: cc.texts.outro, paymentTerms: paymentText(cc, addDays(today(), cc.paymentDays)),
      items: [
        { title: 'Arbeitszeit Geselle', desc: 'Montagearbeiten vor Ort', qty: 4, unit: 'HUR', price: 58, vat: 19 },
        { title: 'Material', desc: 'Kleinmaterial, Befestigungen', qty: 1, unit: 'LS', price: 42.5, vat: 19 },
      ],
    };
    try {
      openPdf(await buildPdf(demo, cc, { name: 'Max Mustermann', street: 'Musterweg 1', zip: '12345', city: 'Musterstadt', number: 'K-1001' }), 'Probe.pdf');
    } catch (e) {
      toast('PDF-Fehler: ' + e.message, 'err');
    }
  };
  $('#del') && ($('#del').onclick = async () => {
    if (db.all('doc', (d) => d.companyId === c.id).length) return toast('Firma hat Belege und kann nicht gelöscht werden.', 'err');
    if (!confirm('Firma wirklich löschen?')) return;
    await db.remove(c.id);
    companyId = db.all('company')[0]?.id || '';
    localStorage.setItem('companyId', companyId);
    go('#/einstellungen');
  });
}

// ---------- Einstellungen ----------
async function viewSettings() {
  const companies = db.all('company');
  const s = sync.getState();
  const clientId = await sync.getClientId();
  shell(`
  <h1>Einstellungen</h1>
  <h2>Firmen</h2>
  <ul class="list">${companies.map((c) => `<li><a href="#/firma/${c.id}"><div><b>${esc(c.name)}</b><br><small>${esc([c.street, c.zip + ' ' + c.city].filter(Boolean).join(', '))}</small></div><div class="right">${c.id === companyId ? '<span class="badge">aktiv</span>' : ''}</div></a></li>`).join('')}</ul>
  <div class="actions"><a class="btn" href="#/firma/neu">+ Firma hinzufügen</a></div>

  <h2>OneDrive</h2>
  <p>Status: <b>${esc(s.message)}</b>${s.lastSync ? ` · zuletzt ${fmtDateTime(s.lastSync)}` : ''}</p>
  <div class="actions">
    ${sync.isConnected() ? '<button class="btn" id="syncNow">Jetzt synchronisieren</button><button class="btn" id="logout">Trennen</button>' : `<button class="btn primary" id="login" ${clientId ? '' : 'disabled'}>Mit OneDrive verbinden</button>`}
  </div>
  <details ${clientId ? '' : 'open'}><summary>Einrichtung (einmalig)</summary>
    <ol class="howto">
      <li>Öffne <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">Microsoft Entra – App-Registrierungen</a> und melde dich mit deinem Microsoft-Konto an.</li>
      <li>„Neue Registrierung“: Name z. B. <i>Handwerk CRM</i>, Kontotypen: <i>Konten in allen Organisationsverzeichnissen und persönliche Microsoft-Konten</i>.</li>
      <li>Umleitungs-URI: Plattform <b>Single-Page-Anwendung (SPA)</b>, Adresse: <code>${esc(sync.appUrl())}</code></li>
      <li>Nach dem Anlegen die <b>Anwendungs-ID (Client-ID)</b> kopieren und hier eintragen.</li>
    </ol>
    <form id="cid" class="grid">${field('Client-ID', 'clientId', clientId, { full: true })}<div class="actions full"><button class="btn">Speichern</button></div></form>
  </details>

  <h2>Darstellung</h2>
  <div class="grid">${select('Farbschema (dieses Gerät)', 'theme', getTheme(), [{ value: 'auto', label: 'Automatisch (wie Gerät)' }, { value: 'light', label: 'Hell' }, { value: 'dark', label: 'Dunkel' }], 'id="themeSel"')}</div>

  <h2>Datensicherung</h2>
  <p class="muted">Zusätzlich zu OneDrive kannst du jederzeit eine komplette Sicherungsdatei herunterladen oder einspielen.</p>
  <div class="actions"><button class="btn" id="export">Sicherung herunterladen</button>
  <label class="btn">Sicherung einspielen<input type="file" id="import" accept="application/json" hidden></label></div>
  <p class="muted small">Version ${__APP_VERSION__}</p>
  `, 'settings');

  $('#themeSel').onchange = (e) => {
    setTheme(e.target.value);
    viewSettings();
  };
  $('#cid').onsubmit = async (e) => {
    e.preventDefault();
    await db.setMeta('msClientId', e.target.clientId.value.trim());
    toast('Gespeichert');
    await sync.init();
    viewSettings();
  };
  $('#login') && ($('#login').onclick = () => sync.login().catch((e) => toast(e.message, 'err')));
  $('#logout') && ($('#logout').onclick = () => sync.logout());
  $('#syncNow') && ($('#syncNow').onclick = () => sync.sync());
  $('#export').onclick = async () => download(JSON.stringify(await db.exportAll()), `crm-sicherung-${today()}.json`, 'application/json');
  $('#import').onchange = async (e) => {
    try {
      const n = await db.importAll(JSON.parse(await e.target.files[0].text()));
      toast(n + ' Datensätze übernommen');
      sync.scheduleSync();
      viewSettings();
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

// ---------- Erststart ----------
function viewWelcome() {
  app.innerHTML = `<main class="welcome">
    <h1>Willkommen bei Handwerk CRM</h1>
    <p>Lege zuerst deine Firma an. Weitere Firmen kannst du jederzeit hinzufügen.</p>
    <div class="actions"><a class="btn primary" href="#/firma/neu">Firma anlegen</a></div>
    <p class="muted">Du nutzt die App schon auf einem anderen Gerät? Dann verbinde zuerst OneDrive, deine Daten werden übernommen.</p>
    <div class="actions"><a class="btn" href="#/einstellungen">OneDrive verbinden</a></div>
  </main>`;
}

// ---------- Router ----------
async function route() {
  const [path, qs] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(qs || '');
  const parts = (path || '/').split('/').filter(Boolean);
  if (!db.get(companyId)) {
    companyId = db.all('company')[0]?.id || '';
    if (companyId) localStorage.setItem('companyId', companyId);
  }
  const needsCompany = !['firma', 'einstellungen'].includes(parts[0]);
  if (!companyId && needsCompany) return viewWelcome();
  if (!companyId && parts[0] === 'einstellungen') {
    // Einstellungen ohne Firma (z. B. OneDrive verbinden)
    return viewSettings();
  }
  window.scrollTo(0, 0);
  switch (parts[0]) {
    case 'kunden': return viewCustomers();
    case 'kunde': return viewCustomer(parts[1]);
    case 'belege': return viewDocs(parts[1], params);
    case 'beleg': return parts[1] === 'neu' ? viewDoc('neu', params, parts[2]) : viewDoc(parts[1], params);
    case 'firma': return viewCompany(parts[1]);
    case 'einstellungen': return viewSettings();
    case 'vorlagen': return viewTemplates();
    default: return viewHome();
  }
}

// Änderungen von anderen Geräten: Listen neu zeichnen, Editoren in Ruhe lassen
db.onChange((info) => {
  if (!info.fromSync) sync.scheduleSync();
  else if (!/beleg\/|kunde\/|firma\//.test(location.hash) || !document.activeElement || document.activeElement === document.body) route();
});
sync.onStatus((s) => {
  const b = $('#syncBtn');
  if (b) {
    b.className = 'sync ' + s.status;
    b.title = s.message;
    b.textContent = syncIcon(s.status);
  }
});
window.addEventListener('online', () => sync.sync());
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sync.sync());

(async () => {
  await db.openDb();
  if (navigator.storage?.persist) navigator.storage.persist();
  await route();
  await sync.init();
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('sw.js');
})();
