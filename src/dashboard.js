// Dashboard auf der Übersicht: Umsatz je Monat (mit Vorjahr), Top-Kunden, offene Posten nach Fälligkeit, Angebotsquote.
// Reines HTML/CSS (skaliert auf Handy und Tablet), Tooltips per Hover oder Antippen, Tabellenansicht für den Monatsvergleich.
import { calcTotals, esc, eur, today } from './util.js';

const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MON_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const kEur = (v) => (Math.abs(v) >= 10000 ? Math.round(v / 1000) + ' T€' : Math.abs(v) >= 1000 ? (v / 1000).toFixed(1).replace('.', ',') + ' T€' : Math.round(v) + ' €');

// „schöne“ Achsenschritte
function niceMax(v) {
  if (v <= 0) return 1000;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// Umsatz einer Rechnung (netto). Schlussrechnung ohne die schon gezählten Abschläge.
function revenueOf(d, c) {
  const net = calcTotals(d, c).net;
  if (d.invoiceType === 'schluss') return net - (d.deductions || []).reduce((s, x) => s + (x.net || 0), 0);
  return net;
}
const counts = (d) => d.kind === 'rechnung' && d.locked && !d.isStorno && !d.isCreditNote && d.status !== 'Storniert' && d.date;

export function dashboardHtml(docs, c, customerName) {
  const now = today();
  const Y = Number(now.slice(0, 4));
  const curM = Number(now.slice(5, 7));
  const md = now.slice(5);
  const inv = docs.filter(counts);
  const byMonth = { [Y]: Array(12).fill(0), [Y - 1]: Array(12).fill(0) };
  let ytd = 0;
  let ytdPrev = 0;
  const custSum = new Map();
  for (const d of inv) {
    const y = Number(d.date.slice(0, 4));
    const m = Number(d.date.slice(5, 7)) - 1;
    const v = revenueOf(d, c);
    if (byMonth[y]) byMonth[y][m] += v;
    if (y === Y) {
      ytd += v;
      const name = d.customerSnapshot?.name || customerName(d.customerId) || 'ohne Kunde';
      custSum.set(name, (custSum.get(name) || 0) + v);
    }
    if (y === Y - 1 && d.date.slice(5) <= md) ytdPrev += v;
  }
  const delta = ytdPrev > 0 ? Math.round(((ytd - ytdPrev) / ytdPrev) * 100) : null;
  const max = niceMax(Math.max(...byMonth[Y], ...byMonth[Y - 1]));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  // Monatsdiagramm
  const cols = MON.map((m, i) => {
    const a = byMonth[Y][i];
    const b = byMonth[Y - 1][i];
    const future = i + 1 > curM;
    const tip = `<b>${MON_LONG[i]}</b><span><i class="sw prev"></i>${Y - 1}: ${eur(b)}</span><span><i class="sw cur"></i>${Y}: ${future ? '–' : eur(a)}</span>`;
    return `<div class="mc-col ${i + 1 === curM ? 'now' : ''}" data-tip="${esc(tip)}" tabindex="0" aria-label="${MON_LONG[i]}: ${Y} ${future ? 'noch offen' : eur(a)}, ${Y - 1} ${eur(b)}">
      <div class="mc-bars"><span class="bar prev" style="height:${(Math.max(b, 0) / max) * 100}%"></span><span class="bar cur" style="height:${future ? 0 : (Math.max(a, 0) / max) * 100}%"></span></div>
      <small>${m}</small></div>`;
  }).join('');
  const table = `<table class="dv-table"><thead><tr><th>Monat</th><th>${Y}</th><th>${Y - 1}</th></tr></thead><tbody>${MON_LONG.map(
    (m, i) => `<tr><td>${m}</td><td>${i + 1 > curM ? '–' : eur(byMonth[Y][i])}</td><td>${eur(byMonth[Y - 1][i])}</td></tr>`,
  ).join('')}<tr class="sum"><td>Summe</td><td>${eur(byMonth[Y].reduce((s, v) => s + v, 0))}</td><td>${eur(byMonth[Y - 1].reduce((s, v) => s + v, 0))}</td></tr></tbody></table>`;

  // Top-Kunden
  const top = [...custSum].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topMax = top[0]?.[1] || 1;
  const topHtml = top.length
    ? top.map(([n, v]) => `<div class="hb" data-tip="${esc(`<b>${esc(n)}</b><span>${eur(v)} netto in ${Y}</span><span>${Math.round((v / ytd) * 100)} % vom Jahresumsatz</span>`)}" tabindex="0"><div class="hb-lbl"><span>${esc(n)}</span><b>${eur(v)}</b></div><div class="hb-track"><span style="width:${(v / topMax) * 100}%"></span></div></div>`).join('')
    : `<p class="muted">Noch keine Rechnungen in ${Y}.</p>`;

  // Offene Posten nach Fälligkeit (brutto, versendet und nicht bezahlt)
  const open = docs.filter((d) => d.kind === 'rechnung' && d.status === 'Versendet' && !d.isStorno);
  const days = (d) => (d.dueDate ? Math.floor((Date.parse(now) - Date.parse(d.dueDate)) / 864e5) : -1);
  const buckets = [
    ['Noch nicht fällig', (x) => x <= 0, 'ok'],
    ['1–30 Tage überfällig', (x) => x >= 1 && x <= 30, 'warn'],
    ['31–60 Tage überfällig', (x) => x >= 31 && x <= 60, 'serious'],
    ['über 60 Tage überfällig', (x) => x > 60, 'crit'],
  ].map(([l, f, s]) => {
    const arr = open.filter((d) => f(days(d)));
    return { l, s, n: arr.length, v: arr.reduce((t, d) => t + calcTotals(d, c).gross, 0) };
  });
  const bMax = Math.max(...buckets.map((b) => b.v), 1);
  const agingHtml = open.length
    ? buckets.map((b) => `<div class="hb st-${b.s}" data-tip="${esc(`<b>${b.l}</b><span>${b.n} ${b.n === 1 ? 'Rechnung' : 'Rechnungen'}</span><span>${eur(b.v)} brutto</span>`)}" tabindex="0"><div class="hb-lbl"><span><i class="st-dot"></i>${b.l} <small class="muted">(${b.n})</small></span><b>${eur(b.v)}</b></div><div class="hb-track"><span style="width:${(b.v / bMax) * 100}%"></span></div></div>`).join('')
    : '<p class="muted">Keine offenen Rechnungen. 👍</p>';

  // Angebotsquote im laufenden Jahr
  const offers = docs.filter((d) => d.kind === 'angebot' && d.date?.startsWith(String(Y)));
  const won = offers.filter((d) => d.status === 'Angenommen').length;
  const decided = offers.filter((d) => ['Angenommen', 'Abgelehnt'].includes(d.status)).length;
  const quote = decided ? Math.round((won / decided) * 100) : null;

  return `<h2 class="sec">Dashboard ${Y}</h2>
  <div class="dash-kpis">
    <div class="kpi"><span>Umsatz ${Y} bis heute (netto)</span><b>${eur(ytd)}</b><small>${delta == null ? `Vorjahr bis heute: ${eur(ytdPrev)}` : `<span class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} %</span> ggü. Vorjahr bis heute (${eur(ytdPrev)})`}</small></div>
    <div class="kpi"><span>Ø Umsatz je Monat</span><b>${eur(ytd / curM)}</b><small>${inv.filter((d) => d.date.startsWith(String(Y))).length} Rechnungen in ${Y}</small></div>
    <div class="kpi"><span>Angebotsquote ${Y}</span><b>${quote == null ? '–' : quote + ' %'}</b><small>${quote == null ? 'noch keine entschiedenen Angebote' : `${won} von ${decided} entschiedenen Angeboten angenommen`}</small></div>
  </div>
  <section class="dash-card">
    <div class="dc-head"><h3>Umsatz je Monat (netto)</h3>
      <div class="dc-tools"><span class="legend"><i class="sw prev"></i>${Y - 1} <i class="sw cur"></i>${Y}</span><button type="button" class="link" id="dvTable">Als Tabelle</button></div></div>
    <div class="mchart" id="dvChart">
      <div class="mc-grid">${ticks.map((t) => `<div style="bottom:${(t / max) * 100}%"><small>${kEur(t)}</small></div>`).join('')}</div>
      <div class="mc-cols">${cols}</div>
    </div>
    <div id="dvTableWrap" hidden>${table}</div>
  </section>
  <div class="dash-two">
    <section class="dash-card"><div class="dc-head"><h3>Top-Kunden ${Y}</h3></div><div class="hbars cust">${topHtml}</div></section>
    <section class="dash-card"><div class="dc-head"><h3>Offene Posten nach Fälligkeit</h3></div><div class="hbars aging">${agingHtml}</div></section>
  </div>`;
}

// Tooltip (Hover mit Maus, Antippen am Handy/Tablet) und Tabellen-Umschalter
export function wireDashboard(root = document) {
  const tip = document.createElement('div');
  tip.className = 'dv-tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  const show = (el) => {
    tip.innerHTML = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(8, Math.min(x, innerWidth - tw - 8));
    let y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    root.querySelectorAll('[data-tip].hot').forEach((e) => e.classList.remove('hot'));
    el.classList.add('hot');
  };
  const hide = () => {
    tip.hidden = true;
    root.querySelectorAll('[data-tip].hot').forEach((e) => e.classList.remove('hot'));
  };
  root.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && show(el));
    el.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hide());
    el.addEventListener('click', (e) => {
      if (e.pointerType === 'mouse') return;
      show(el);
    });
    el.addEventListener('focus', () => show(el));
    el.addEventListener('blur', hide);
  });
  addEventListener('scroll', hide, { passive: true });
  const outside = (e) => !e.target.closest?.('[data-tip]') && hide();
  document.addEventListener('click', outside);
  const btn = root.querySelector('#dvTable');
  if (btn)
    btn.onclick = () => {
      const w = root.querySelector('#dvTableWrap');
      const ch = root.querySelector('#dvChart');
      w.hidden = !w.hidden;
      ch.hidden = !w.hidden;
      btn.textContent = w.hidden ? 'Als Tabelle' : 'Als Diagramm';
    };
  // beim Seitenwechsel aufräumen
  addEventListener('hashchange', () => (tip.remove(), removeEventListener('scroll', hide), document.removeEventListener('click', outside)), { once: true });
}
