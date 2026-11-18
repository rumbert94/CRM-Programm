// Merkliste: schnelle Notizen von unterwegs, auftragsunabhängig, in zwei Listen „Bestellen“ (Material) und „To-do“.
// Jeder Eintrag ist ein eigener Datensatz (type 'memo'), damit Änderungen auf mehreren Geräten sich nicht überschreiben.
import * as db from './db.js';
import { esc } from './util.js';

export const CATS = [
  ['bestellen', 'Bestellen'],
  ['todo', 'To-do'],
];
export const memos = (companyId) => db.all('memo', (m) => m.companyId === companyId && !m.deleted);
export const openCount = (companyId) => memos(companyId).filter((m) => !m.done).length;

// Spracheingabe an ein Textfeld hängen (Chrome/Android/Safari). Gibt den Knopf-HTML zurück, wenn verfügbar.
const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
export const micButton = () => (SR() ? '<button type="button" class="btn" id="memoMic">🎤 Sprechen</button>' : '');
function wireMic(root, ta, toast) {
  const btn = root.querySelector('#memoMic');
  if (!btn) return () => {};
  let rec;
  btn.onclick = () => {
    if (rec) return rec.stop();
    const S = SR();
    rec = new S();
    rec.lang = 'de-DE';
    rec.continuous = true;
    rec.interimResults = false;
    const base = ta.value ? ta.value.trimEnd() + '\n' : '';
    rec.onresult = (ev) => (ta.value = base + Array.from(ev.results).map((r) => r[0].transcript.trim()).join('\n'));
    rec.onerror = (ev) => toast('Spracheingabe: ' + (ev.error === 'not-allowed' ? 'Mikrofon nicht erlaubt' : ev.error), 'err');
    rec.onend = () => {
      rec = null;
      btn.textContent = '🎤 Sprechen';
      btn.classList.remove('rec');
    };
    rec.start();
    btn.textContent = '⏹ Stopp';
    btn.classList.add('rec');
  };
  return () => rec?.stop();
}

// Mehrere Zeilen = mehrere Einträge
async function addLines(companyId, cat, text) {
  const lines = text.split('\n').map((l) => l.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
  for (const l of lines) await db.put({ type: 'memo', companyId, cat, text: l, done: false, at: Date.now() });
  return lines.length;
}

// Schnell-Erfassung (Overlay), z. B. vom Knopf in der Übersicht
export function quickMemo({ companyId, toast, cat = sessionStorage.getItem('memoCat') || 'bestellen', onSaved = () => {} }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="sheet memo-sheet"><div class="bar"><h2>Schnell notieren</h2><button class="link" data-close>Schließen</button></div>
    <div class="segs memo-cats">${CATS.map(([k, l]) => `<button type="button" class="seg ${k === cat ? 'on' : ''}" data-cat="${k}">${l}</button>`).join('')}</div>
    <textarea id="memoText" rows="4" placeholder="z. B. 2× Eckventil ½ Zoll, Silikon weiß&#10;Jede Zeile wird ein eigener Eintrag."></textarea>
    <div class="actions">${micButton()}<button type="button" class="btn primary" id="memoSave">Speichern</button></div>
    <p class="muted"><small>Tipp: Auf dem iPhone/iPad kannst du auch das Mikrofon der Tastatur zum Diktieren nutzen.</small></p></div>`;
  document.body.appendChild(ov);
  const ta = ov.querySelector('#memoText');
  const stopMic = wireMic(ov, ta, toast);
  const close = () => {
    stopMic();
    ov.remove();
  };
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-close]')) close();
    const c = e.target.closest('[data-cat]');
    if (c) {
      cat = c.dataset.cat;
      sessionStorage.setItem('memoCat', cat);
      ov.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', b === c));
      ta.focus();
    }
  });
  ov.querySelector('#memoSave').onclick = async () => {
    stopMic();
    const n = await addLines(companyId, cat, ta.value);
    if (!n) return toast('Bitte erst etwas eintippen oder einsprechen', 'err');
    close();
    toast(`${n} ${n === 1 ? 'Eintrag' : 'Einträge'} unter „${CATS.find((c) => c[0] === cat)[1]}“ gespeichert`);
    onSaved();
  };
  ta.focus();
}

// Seite „Merkliste“
export function memoPage({ companyId, shell, pageHead, toast, rerender }) {
  const tab = sessionStorage.getItem('memoTab') || 'bestellen';
  const all = memos(companyId);
  const open = (k) => all.filter((m) => m.cat === k && !m.done).sort((a, b) => a.at - b.at);
  const done = all.filter((m) => m.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const list = tab === 'erledigt' ? done : open(tab);
  const fmt = (t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const row = (m) => `<li class="tk-item ${m.done ? 'done' : ''}" data-mid="${m.id}">
      <label class="tk-check"><input type="checkbox" ${m.done ? 'checked' : ''} data-m-done></label>
      <input class="tk-text" value="${esc(m.text)}" data-m-text aria-label="Eintrag">
      <small class="muted memo-at">${tab === 'erledigt' ? esc(CATS.find((c) => c[0] === m.cat)?.[1] || '') + ' · ' : ''}${fmt(m.done ? m.doneAt || m.at : m.at)}</small>
      <button type="button" class="link danger" data-m-del title="löschen">✕</button></li>`;
  shell(`
  ${pageHead('Merkliste', '<button class="btn primary" id="memoNew">+ Schnell notieren</button>', 'Material zum Bestellen und spontane To-dos – unabhängig von Aufträgen')}
  <div class="toolbar"><div class="segs">${[...CATS, ['erledigt', 'Erledigt']]
    .map(([k, l]) => `<button type="button" class="seg ${k === tab ? 'on' : ''}" data-tab="${k}">${l} <span class="count ${k === 'erledigt' ? 'plain' : ''}">${k === 'erledigt' ? done.length : open(k).length}</span></button>`)
    .join('')}</div>
    ${tab === 'bestellen' && list.length ? '<button type="button" class="btn" id="memoShare">📋 Bestellliste kopieren / teilen</button>' : ''}
    ${tab === 'erledigt' && list.length ? '<button type="button" class="btn danger" id="memoPurge">Erledigte löschen</button>' : ''}</div>
  ${tab !== 'erledigt' ? `<form class="tk-add" id="memoAdd"><input id="memoAddText" placeholder="${tab === 'bestellen' ? 'Material, z. B. 10 m Kupferrohr 15 mm' : 'z. B. Kunde Müller zurückrufen'}" autocomplete="off"><button class="btn">+ Hinzufügen</button></form>` : ''}
  ${list.length ? `<ul class="tk-list memo-list card">${list.map(row).join('')}</ul>` : `<p class="empty">${tab === 'erledigt' ? 'Noch nichts erledigt.' : 'Nichts offen. 👍'}</p>`}
  `, 'merkliste');
  const $ = (s) => document.querySelector(s);
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => {
    sessionStorage.setItem('memoTab', b.dataset.tab);
    rerender();
  }));
  $('#memoNew').onclick = () => quickMemo({ companyId, toast, cat: tab === 'erledigt' ? undefined : tab, onSaved: rerender });
  $('#memoAdd') && ($('#memoAdd').onsubmit = async (e) => {
    e.preventDefault();
    const v = $('#memoAddText').value;
    if (!(await addLines(companyId, tab, v))) return;
    rerender();
    document.querySelector('#memoAddText')?.focus();
  });
  const rec = (el) => db.get(el.closest('[data-mid]').dataset.mid);
  document.querySelectorAll('[data-m-done]').forEach((cb) => (cb.onchange = async () => {
    const m = rec(cb);
    await db.put({ ...m, done: cb.checked, doneAt: cb.checked ? Date.now() : undefined });
    rerender();
  }));
  document.querySelectorAll('[data-m-text]').forEach((inp) => (inp.onchange = async () => {
    const m = rec(inp);
    const v = inp.value.trim();
    await db.put(v ? { ...m, text: v } : { ...m, deleted: true });
    if (!v) rerender();
  }));
  // Löschen als Markierung, damit es auf allen Geräten verschwindet
  document.querySelectorAll('[data-m-del]').forEach((b) => (b.onclick = async () => {
    await db.put({ ...rec(b), deleted: true });
    rerender();
  }));
  $('#memoPurge') && ($('#memoPurge').onclick = async () => {
    if (!confirm('Alle erledigten Einträge löschen?')) return;
    for (const m of done) await db.put({ ...m, deleted: true });
    rerender();
  });
  $('#memoShare') && ($('#memoShare').onclick = async () => {
    const text = 'Bestellliste\n' + list.map((m) => '- ' + m.text).join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'Bestellliste', text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Bestellliste kopiert – z. B. in WhatsApp oder E-Mail einfügen');
      }
    } catch (e) {
      if (e?.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(text);
          toast('Bestellliste kopiert');
        } catch {
          toast('Kopieren nicht möglich', 'err');
        }
      }
    }
  });
}
