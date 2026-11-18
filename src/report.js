// Regiebericht (Arbeitsauftrag / -protokoll) für unterwegs:
// Kunde, Arbeitszeit, Monteure, Fahrtkosten, Zulagen, ausgeführte Arbeiten,
// Unterschrift am Gerät, PDF und Umwandlung in eine Rechnung.
import * as db from './db.js';
import { esc, uid, fmtDate, fmtNum, parseNum, round2, today, UNITS, unitLabel, download, safeFile } from './util.js';

export const REGIE_LEGAL_DEFAULT =
  '* Schmutzzulage: Betrifft insbesondere Arbeiten an Schmutzwasserleitungen, Kontakt mit Fäkalien, Ölen und anderen Schmierstoffen, Chemikalien und anderen Gefahrenstoffen. Über das Anfallen der Zulage entscheidet der Monteur nach eigenem Ermessen.\n' +
  'Eine nachträgliche Reklamation der Fahrtkosten, Arbeitszeitzulagen und Leistungen ist ausgeschlossen.\n' +
  'Der Auftraggeber bestätigt die Richtigkeit der Angaben und die Mängelfreiheit der o. g. erbrachten Leistungen zum Zeitpunkt der Abnahme. ' +
  'Der Auftraggeber bestätigt, eine Ausfertigung des Arbeitsauftrags und die Datenschutzinformationen nach Art. 13 ff. EU-DSGVO erhalten zu haben. ' +
  'Der Auftraggeber bestätigt, die Allgemeinen Geschäftsbedingungen (AGB) des Auftragnehmers zur Kenntnis genommen und akzeptiert zu haben.';

export const TRAVEL = [
  { key: 'none', label: 'ohne' },
  { key: '5', label: 'bis 5 km', km: 5, def: 15 },
  { key: '25', label: 'bis 25 km', km: 25, def: 40 },
  { key: '50', label: 'bis 50 km', km: 50, def: 75 },
];
export const SURCHARGE = [
  { key: 'none', label: 'ohne', pct: 0 },
  { key: '25', label: '25 % (17:00 – 21:59)', pct: 25 },
  { key: '50n', label: '50 % (22:00 – 06:59)', pct: 50 },
  { key: '50s', label: '50 % Sonn- und Feiertage', pct: 50 },
];
export const travelPrice = (c, key) => {
  const t = TRAVEL.find((x) => x.key === key);
  if (!t || !t.km) return 0;
  const v = c?.regie?.['travel' + t.km];
  return v === undefined || v === '' ? t.def : parseNum(v);
};

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
// Arbeitszeit aus Beginn/Ende/Pause in Stunden (über Mitternacht möglich)
export function spanHours(r) {
  const a = toMin(r.start);
  const b = toMin(r.end);
  if (a === null || b === null) return 0;
  let m = b - a;
  if (m < 0) m += 24 * 60;
  m -= parseNum(r.pause || 0);
  return Math.max(0, round2(m / 60));
}
export const workerHours = (r, w) => (w.hours === '' || w.hours === undefined || w.hours === null ? spanHours(r) : parseNum(w.hours));
export const totalHours = (r) => round2((r.workers || []).reduce((s, w) => s + workerHours(r, w), 0));
export const reportFileName = (r) => 'RB' + (r.number || 'Entwurf');

function nextReportNumber(c) {
  const yy = String(new Date().getFullYear()).slice(2);
  let max = 0;
  for (const r of db.allRaw()) {
    if (r.type !== 'report' || r.companyId !== c.id || !r.number?.startsWith(yy)) continue;
    const n = parseInt(r.number.slice(2), 10);
    if (n > max) max = n;
  }
  return yy + String(max + 1).padStart(2, '0');
}

// Prüfsumme über den unterschriebenen Inhalt (macht spätere Änderungen erkennbar)
async function contentHash(r) {
  const core = JSON.stringify({
    n: r.number, k: r.customerSnapshot, d: r.date, p: r.project, s: r.start, e: r.end, pa: r.pause,
    w: r.workers, t: r.travel, z: r.surcharge, sz: r.dirt, i: r.items, no: r.notes, sig: r.signature?.img, sn: r.signature?.name, at: r.signature?.at,
  });
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(core));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Unterschriftenfeld ----------
function signPad(canvas) {
  const ctx = canvas.getContext('2d');
  let ink = false;
  let last = null;
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b1f4d';
    ink = false;
  };
  fit();
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    last = pos(e);
    ctx.beginPath();
    ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    ink = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!last) return;
    e.preventDefault();
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  });
  const end = () => (last = null);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  return {
    clear: () => ctx.clearRect(0, 0, canvas.width, canvas.height) || (ink = false),
    isEmpty: () => !ink,
    toDataURL: () => canvas.toDataURL('image/png'),
    fit,
  };
}

export function initReports(ctx) {
  const { $, $$, shell, field, select, go, toast, company, getCompanyId, pickTemplate, newDoc, icon, avatar, pageHead, searchBox, setPending, debounce } = ctx;

  const STATUS = ['Entwurf', 'Unterschrieben', 'Abgerechnet'];

  function viewReports(params) {
    const f = params.get('f') || '';
    const q = (sessionStorage.getItem('repQ') || '').toLowerCase();
    const all = db.all('report', (r) => r.companyId === getCompanyId());
    const chips = [['', 'Alle'], ['entwurf', 'Offen', (r) => r.status === 'Entwurf'], ['unterschrieben', 'Unterschrieben', (r) => r.status === 'Unterschrieben'], ['abgerechnet', 'Abgerechnet', (r) => r.status === 'Abgerechnet']];
    const pred = chips.find((x) => x[0] === f)?.[2];
    let list = pred ? all.filter(pred) : all;
    const name = (r) => r.customerSnapshot?.name || db.get(r.customerId)?.name || '';
    if (q) list = list.filter((r) => [r.number, name(r), r.project].join(' ').toLowerCase().includes(q));
    list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || 0) - (a.updatedAt || 0));
    shell(`
    ${pageHead('Regieberichte', '<a class="btn primary" href="#/bericht/neu">+ Regiebericht</a>')}
    <div class="toolbar"><div class="segs">${chips
      .map(([k, l, p]) => {
        const n = p && k === 'unterschrieben' ? all.filter(p).length : 0;
        return `<a class="seg ${k === f ? 'on' : ''}" href="#/berichte${k ? '?f=' + k : ''}">${l}${n ? ` <span class="count">${n}</span>` : ''}</a>`;
      })
      .join('')}</div>${searchBox('q', q, 'Kunde, Nummer, Vorhaben …')}</div>
    ${list.length ? `<ul class="list">${list
      .map((r) => `<li><a class="row" href="#/bericht/${r.id}"><span class="row-ic">${icon('bericht')}</span>${avatar(name(r))}
        <div class="row-main"><b>${esc(name(r) || 'Ohne Kunde')}</b><small>Regiebericht ${esc(r.number || '(Entwurf)')} · ${esc(fmtDate(r.date))}${r.project ? ' · ' + esc(r.project) : ''}</small></div>
        <span class="badge ${esc(r.status)}">${esc(r.status)}</span><b class="amount">${fmtNum(totalHours(r))} Std</b>${icon('chevron', 'chev')}</a></li>`)
      .join('')}</ul>` : '<p class="empty">Noch keine Regieberichte.</p>'}`, 'bericht');
    const qi = $('#q');
    qi.oninput = debounce(() => {
      sessionStorage.setItem('repQ', qi.value);
      viewReports(params);
      const n = $('#q');
      n.focus();
      n.setSelectionRange(n.value.length, n.value.length);
    }, 250);
  }

  function viewReport(id) {
    const c = company();
    const nowT = new Date();
    const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(Math.floor(d.getMinutes() / 15) * 15).padStart(2, '0')}`;
    let r =
      id === 'neu'
        ? {
            id: uid(), type: 'report', companyId: getCompanyId(), customerId: '', number: '', date: today(), project: '',
            start: hhmm(nowT), end: '', pause: '', workers: [{ id: uid(), name: c.owner || c.contactName || '', hours: '' }],
            travel: 'none', surcharge: 'none', dirt: false, items: [{ id: uid(), qty: '1', unit: 'H87', desc: '' }], notes: '', status: 'Entwurf',
          }
        : db.get(id);
    if (!r) return go('#/berichte');
    const isNew = id === 'neu';
    let locked = !!r.signature;
    let dis = locked ? 'disabled' : '';
    const customers = () => db.all('customer', (k) => k.companyId === getCompanyId()).sort((a, b) => a.name.localeCompare(b.name));
    const radios = (name, opts, cur, labelFn) =>
      `<div class="chips-row">${opts.map((o) => `<label class="chip"><input type="radio" name="${name}" value="${o.key}" ${o.key === cur ? 'checked' : ''} ${dis}><span>${esc(labelFn(o))}</span></label>`).join('')}</div>`;
    const sigBox = (s, label) =>
      s ? `<div class="sig-done"><img src="${s.img}" alt="Unterschrift"><div><b>${esc(s.name || '')}</b><small>${esc(label)} · ${new Date(s.at).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</small></div></div>` : '';

    const render = () => {
      locked = !!r.signature;
      dis = locked ? 'disabled' : '';
      shell(`
      <div class="page-head"><div><h1>Regiebericht ${r.number ? 'Nr. ' + esc(r.number) : ''}</h1><p class="sub">${esc(c.name)}</p></div>
        <span class="badge ${esc(r.status)}">${esc(r.status)}</span></div>
      ${locked ? '<p class="info">Unterschrieben – der Bericht ist gesperrt. Zum Ändern zuerst die Unterschrift entfernen.</p>' : ''}
      <form id="rf" class="report">
        <section class="rcard"><h3>Kunde & Vorhaben</h3>
          <div class="grid">
            <label class="field"><span>Kunde *</span><select name="customerId" ${dis}><option value="">– bitte wählen –</option>${customers()
              .map((k) => `<option value="${k.id}" ${k.id === r.customerId ? 'selected' : ''}>${esc(k.name)}${k.city ? ' (' + esc(k.city) + ')' : ''}</option>`)
              .join('')}</select>${locked ? '' : '<small><button type="button" class="link" id="quickCust">+ neuen Kunden anlegen</button></small>'}</label>
            ${field('Datum', 'date', r.date, { type: 'date', attrs: dis })}
            ${field('Vorhaben / Einsatzort', 'project', r.project, { full: true, attrs: dis + ' placeholder="z. B. Armatur Badewanne, Musterstr. 1"' })}
          </div></section>
        <section class="rcard"><h3>Arbeitszeit</h3>
          <div class="grid three">
            ${field('Beginn', 'start', r.start, { type: 'time', attrs: dis })}
            ${field('Ende', 'end', r.end, { type: 'time', attrs: dis })}
            ${field('Pause (Min.)', 'pause', r.pause, { type: 'number', attrs: dis + ' min="0" step="5" inputmode="numeric"' })}
          </div>
          <div id="workers">${(r.workers || [])
            .map((w) => `<div class="wrow" data-w="${w.id}"><input class="w-name" placeholder="Monteur" value="${esc(w.name || '')}" ${dis}>
              <label class="w-h"><input class="w-hours" inputmode="decimal" placeholder="${fmtNum(spanHours(r))}" value="${esc(w.hours ?? '')}" ${dis}><span>Std</span></label>
              ${locked ? '' : '<button type="button" class="link danger w-del" aria-label="Monteur entfernen">✕</button>'}</div>`)
            .join('')}</div>
          ${locked ? '' : '<div class="actions"><button type="button" class="btn" id="addW">+ Monteur</button></div>'}
          <p class="muted small">Stunden leer lassen = aus Beginn/Ende/Pause berechnet. Gesamt: <b id="hTotal">${fmtNum(totalHours(r))} Std</b></p>
        </section>
        <section class="rcard"><h3>Fahrtkostenpauschale</h3>${radios('travel', TRAVEL, r.travel, (o) => (o.km ? `${o.label} · ${fmtNum(travelPrice(c, o.key))} €` : o.label))}</section>
        <section class="rcard"><h3>Überstunden- / Arbeitszeitzulage</h3>${radios('surcharge', SURCHARGE, r.surcharge, (o) => o.label)}</section>
        <section class="rcard"><div class="switch-row"><h3>Schmutzzulage 50 %*</h3>
          <label class="switch"><input type="checkbox" name="dirt" ${r.dirt ? 'checked' : ''} ${dis}><span class="track"></span><span class="sw-label">${r.dirt ? 'ja' : 'nein'}</span></label></div></section>
        <section class="rcard"><h3>Ausgeführte Arbeiten, Material, Vereinbarungen</h3>
          <div id="ritems">${(r.items || [])
            .map((it) => `<div class="irow" data-i="${it.id}">
              <input class="i-qty" inputmode="decimal" placeholder="Menge" value="${esc(it.qty ?? '')}" ${dis}>
              <select class="i-unit" ${dis}>${UNITS.map((u) => `<option value="${u.code}" ${u.code === it.unit ? 'selected' : ''}>${u.label}</option>`).join('')}</select>
              <textarea class="i-desc" rows="1" placeholder="z. B. Armatur Badewanne gewechselt" ${dis}>${esc(it.desc || '')}</textarea>
              ${locked ? '' : '<button type="button" class="link danger i-del" aria-label="Zeile entfernen">✕</button>'}</div>`)
            .join('')}</div>
          ${locked ? '' : '<div class="actions"><button type="button" class="btn" id="addI">+ Zeile</button><button type="button" class="btn" id="addTpl">☆ aus Vorlage</button></div>'}
          ${field('Bemerkungen', 'notes', r.notes, { type: 'textarea', full: true, attrs: dis })}
        </section>
        <section class="rcard"><h3>Unterschriften</h3>
          ${sigBox(r.signature, 'Auftraggeber')}
          ${sigBox(r.monteurSig, 'Monteur')}
          <div class="actions">
            ${r.signature ? '' : '<button type="button" class="btn primary big" id="signCust">✍ Kunde unterschreiben lassen</button>'}
            ${r.monteurSig ? '' : '<button type="button" class="btn" id="signMon">✍ Monteur unterschreibt</button>'}
            ${r.signature && r.status !== 'Abgerechnet' ? '<button type="button" class="btn danger" id="unsign">Unterschrift entfernen</button>' : ''}
          </div>
        </section>
      </form>
      <div class="actions sticky">
        <button class="btn primary" id="rPdf">PDF herunterladen</button>
        ${r.invoiceId && db.get(r.invoiceId) ? `<a class="btn" href="#/beleg/${r.invoiceId}">Zur Rechnung →</a>` : '<button class="btn" id="toInv">In Rechnung umwandeln →</button>'}
        ${r.status === 'Abgerechnet' || isNew ? '' : '<button class="btn danger push-right" id="rDel">Löschen</button>'}
      </div>
      <p class="muted small" id="rState"></p>`, 'bericht');
      wire();
    };

    const collect = () => {
      if (locked) return;
      const f = $('#rf');
      r.customerId = f.customerId.value;
      r.date = f.date.value;
      r.project = f.project.value;
      r.start = f.start.value;
      r.end = f.end.value;
      r.pause = f.pause.value;
      r.travel = f.travel.value || 'none';
      r.surcharge = f.surcharge.value || 'none';
      r.dirt = f.dirt.checked;
      r.notes = f.notes.value;
      r.workers = $$('#workers [data-w]').map((el) => ({ id: el.dataset.w, name: $('.w-name', el).value, hours: $('.w-hours', el).value.trim() }));
      r.items = $$('#ritems [data-i]').map((el) => ({ id: el.dataset.i, qty: $('.i-qty', el).value, unit: $('.i-unit', el).value, desc: $('.i-desc', el).value }));
    };
    const empty = () => !r.customerId && !r.project && !(r.items || []).some((i) => i.desc?.trim());
    const save = async () => {
      collect();
      if (empty() && !db.get(r.id)) return;
      r = await db.put(r, { silent: true });
      if (location.hash.includes('/neu')) history.replaceState(null, '', '#/bericht/' + r.id);
      const st = $('#rState');
      if (st) st.textContent = 'Automatisch gespeichert ' + new Date().toLocaleTimeString('de-DE');
    };
    const later = debounce(() => save(), 600);
    const autosave = () => {
      collect();
      const t = $('#hTotal');
      if (t) t.textContent = fmtNum(totalHours(r)) + ' Std';
      $$('.w-hours').forEach((i) => (i.placeholder = fmtNum(spanHours(r))));
      setPending(save);
      later();
    };

    function signSheet(title, nameDefault, legal, onDone) {
      const ov = document.createElement('div');
      ov.className = 'overlay sign-ov';
      ov.innerHTML = `<div class="sheet sign-sheet">
        <div class="bar"><h2>${esc(title)}</h2><button class="link" data-close>Abbrechen</button></div>
        ${legal ? `<div class="sign-sum"><b>${esc(db.get(r.customerId)?.name || '')}</b> · ${esc(fmtDate(r.date))} · ${fmtNum(totalHours(r))} Std${r.project ? ' · ' + esc(r.project) : ''}</div>
          <div class="sign-legal">${esc(legal).replace(/\n/g, '<br>')}</div>` : ''}
        <label class="field"><span>Vor- und Zuname</span><input id="sgName" value="${esc(nameDefault || '')}" autocomplete="off"></label>
        <div class="sign-wrap"><canvas id="sgPad"></canvas><span class="sign-hint">Hier mit dem Finger oder Stift unterschreiben</span></div>
        <div class="actions"><button class="btn" id="sgClear">Neu</button><button class="btn primary push-right" id="sgOk">Unterschrift bestätigen</button></div>
      </div>`;
      document.body.appendChild(ov);
      const pad = signPad($('#sgPad', ov));
      const onResize = () => pad.fit();
      window.addEventListener('resize', onResize);
      const close = () => {
        window.removeEventListener('resize', onResize);
        ov.remove();
      };
      $('#sgPad', ov).addEventListener('pointerdown', () => ($('.sign-hint', ov).style.display = 'none'));
      $('[data-close]', ov).onclick = close;
      $('#sgClear', ov).onclick = () => {
        pad.clear();
        $('.sign-hint', ov).style.display = '';
      };
      $('#sgOk', ov).onclick = async () => {
        const name = $('#sgName', ov).value.trim();
        if (!name) return toast('Bitte den Namen eintragen.', 'err');
        if (pad.isEmpty()) return toast('Bitte unterschreiben.', 'err');
        const img = pad.toDataURL();
        close();
        await onDone({ img, name, at: Date.now() });
      };
    }

    function quickCustomer() {
      const ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = `<div class="sheet"><div class="bar"><h2>Neuer Kunde</h2><button class="link" data-close>Abbrechen</button></div>
        <form id="qc" class="grid">
          ${field('Name / Firma *', 'name', '', { attrs: 'required' })}
          ${field('Straße, Nr.', 'street', '')}
          ${field('PLZ', 'zip', '', { attrs: 'inputmode="numeric"' })}
          ${field('Ort', 'city', '')}
          ${field('Telefon', 'phone', '', { type: 'tel' })}
          ${field('E-Mail', 'email', '', { type: 'email' })}
          <div class="full actions"><button class="btn primary">Kunde anlegen</button></div>
        </form></div>`;
      document.body.appendChild(ov);
      $('[data-close]', ov).onclick = () => ov.remove();
      $('[name=name]', ov).focus();
      $('#qc', ov).onsubmit = async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target));
        const base = ctx.newCustomer();
        const k = await db.put({ ...base, ...data, country: 'DE' });
        ov.remove();
        collect();
        r.customerId = k.id;
        render();
        await save();
        toast('Kunde angelegt');
      };
    }

    function wire() {
      const f = $('#rf');
      f.addEventListener('input', autosave);
      f.addEventListener('change', (e) => {
        const cb = e.target.closest('.switch input');
        if (cb) cb.parentElement.querySelector('.sw-label').textContent = cb.checked ? 'ja' : 'nein';
        autosave();
      });
      f.onsubmit = (e) => e.preventDefault();
      $('#quickCust') && ($('#quickCust').onclick = quickCustomer);
      $('#addW') && ($('#addW').onclick = () => {
        collect();
        r.workers.push({ id: uid(), name: '', hours: '' });
        render();
        $$('.w-name').at(-1)?.focus();
      });
      $('#addI') && ($('#addI').onclick = () => {
        collect();
        r.items.push({ id: uid(), qty: '1', unit: 'H87', desc: '' });
        render();
        $$('.i-desc').at(-1)?.focus();
      });
      $('#addTpl') && ($('#addTpl').onclick = () =>
        pickTemplate((tpl) => {
          collect();
          if (r.items.length && !r.items.at(-1).desc?.trim()) r.items.pop();
          r.items.push({ id: uid(), qty: '1', unit: tpl.unit || 'H87', desc: [tpl.title, tpl.desc].filter(Boolean).join('\n'), articleId: tpl.id });
          save().then(render);
        }));
      f.addEventListener('click', (e) => {
        const wd = e.target.closest('.w-del');
        const idl = e.target.closest('.i-del');
        if (!wd && !idl) return;
        collect();
        if (wd) r.workers = r.workers.filter((w) => w.id !== wd.closest('[data-w]').dataset.w);
        if (idl) r.items = r.items.filter((i) => i.id !== idl.closest('[data-i]').dataset.i);
        save().then(render);
      });
      $('#signCust') && ($('#signCust').onclick = async () => {
        collect();
        const k = db.get(r.customerId);
        if (!k) return toast('Bitte zuerst einen Kunden wählen.', 'err');
        if (!totalHours(r) && !r.items.some((i) => i.desc?.trim())) return toast('Bitte Arbeitszeit oder ausgeführte Arbeiten eintragen.', 'err');
        await save();
        signSheet('Unterschrift Auftraggeber', k.contact || k.name, c.regie?.legalText?.trim() || REGIE_LEGAL_DEFAULT, async (sig) => {
          r.signature = sig;
          r.number = r.number || nextReportNumber(c);
          r.customerSnapshot = { ...k };
          r.status = 'Unterschrieben';
          r.hash = await contentHash(r);
          r = await db.put(r);
          toast('Unterschrift gespeichert – Bericht ' + r.number);
          render();
        });
      });
      $('#signMon') && ($('#signMon').onclick = async () => {
        collect();
        await save();
        signSheet('Unterschrift Monteur', r.workers?.[0]?.name || c.owner || '', '', async (sig) => {
          r.monteurSig = sig;
          r = await db.put(r);
          toast('Unterschrift Monteur gespeichert');
          render();
        });
      });
      $('#unsign') && ($('#unsign').onclick = async () => {
        if (!confirm('Unterschrift des Kunden entfernen? Der Bericht muss danach neu unterschrieben werden.')) return;
        delete r.signature;
        delete r.hash;
        r.status = 'Entwurf';
        r = await db.put(r);
        render();
      });
      $('#rPdf').onclick = async () => {
        collect();
        if (!locked) await save();
        const k = r.customerSnapshot || db.get(r.customerId) || {};
        const { buildReportPdf } = await import('./reportpdf.js');
        const bytes = await buildReportPdf(r, company(), k);
        download(bytes, safeFile(reportFileName(r)) + '.pdf', 'application/pdf');
        ctx.offerArchive?.(bytes, safeFile(reportFileName(r)) + '.pdf', 'application/pdf');
      };
      $('#toInv') && ($('#toInv').onclick = async () => {
        collect();
        if (!r.customerId) return toast('Bitte zuerst einen Kunden wählen.', 'err');
        if (!r.signature && !confirm('Der Bericht ist noch nicht unterschrieben. Trotzdem in eine Rechnung umwandeln?')) return;
        await save();
        const inv = toInvoice(r, company());
        await db.put(inv);
        r.invoiceId = inv.id;
        r.status = 'Abgerechnet';
        r = await db.put(r);
        toast('Rechnungsentwurf erstellt – bitte Preise prüfen');
        go('#/beleg/' + inv.id);
      });
      $('#rDel') && ($('#rDel').onclick = async () => {
        if (!confirm('Regiebericht wirklich löschen?')) return;
        await db.remove(r.id);
        go('#/berichte');
      });
    }

    // Rechnung aus dem Bericht: Arbeitszeit je Monteur, Zulagen, Fahrtkosten, Material
    function toInvoice(r, c) {
      const rate = parseNum(c.regie?.rate || 0);
      const vat = c.defaultVat ?? 19;
      const hours = totalHours(r);
      const items = [];
      const ws = (r.workers || []).filter((w) => workerHours(r, w) > 0);
      for (const w of ws) items.push({ id: uid(), title: '', desc: `Arbeitszeit${w.name ? ' ' + w.name : ' Monteur'} am ${fmtDate(r.date)}`, qty: fmtNum(workerHours(r, w)), unit: 'HUR', price: rate ? fmtNum(rate) : '', vat });
      const s = SURCHARGE.find((x) => x.key === r.surcharge);
      if (s?.pct && hours) items.push({ id: uid(), title: '', desc: `Zuschlag ${s.label}`, qty: fmtNum(hours), unit: 'HUR', price: rate ? fmtNum(round2((rate * s.pct) / 100)) : '', vat });
      if (r.dirt && hours) items.push({ id: uid(), title: '', desc: 'Schmutzzulage 50 %', qty: fmtNum(hours), unit: 'HUR', price: rate ? fmtNum(round2(rate * 0.5)) : '', vat });
      const t = TRAVEL.find((x) => x.key === r.travel);
      if (t?.km) items.push({ id: uid(), title: '', desc: `Kfz-Fahrtkostenpauschale < ${t.km} km am ${fmtDate(r.date)}`, qty: '1', unit: 'H87', price: fmtNum(travelPrice(c, t.key)), vat });
      for (const it of r.items || []) {
        if (!it.desc?.trim()) continue;
        const art = it.articleId ? db.get(it.articleId) : db.all('article', (a) => a.companyId === c.id && (a.desc === it.desc || a.title === it.desc))[0];
        items.push({ id: uid(), title: '', desc: it.desc, qty: it.qty || '1', unit: it.unit || 'H87', price: art?.price ?? '', vat: art?.vat ?? vat });
      }
      return newDoc('rechnung', {
        customerId: r.customerId,
        subject: [r.project, `Regiebericht Nr. ${r.number || '–'} vom ${fmtDate(r.date)}`].filter(Boolean).join('\n'),
        serviceDate: r.date,
        sourceReportId: r.id,
        items,
      });
    }

    render();
  }

  return { viewReports, viewReport };
}

export { unitLabel };
