// Aufgaben (To-do-Liste) je Auftrag. Eigener Datensatz „tasks“ pro Auftrag, wird wie alles andere synchronisiert.
import * as db from './db.js';
import { esc, uid } from './util.js';
import { getAiKey } from './ai-key.js';

const tid = (docId) => 'tasks_' + docId;
export const tasksOf = (docId) => db.get(tid(docId))?.items || [];
export const progress = (items) => {
  const n = items.length;
  const done = items.filter((t) => t.done).length;
  return { n, done, open: n - done, pct: n ? Math.round((done / n) * 100) : 0 };
};
async function saveTasks(doc, items) {
  const old = db.get(tid(doc.id));
  await db.put({ ...(old || {}), id: tid(doc.id), type: 'tasks', companyId: doc.companyId, docId: doc.id, items });
}
// Laufende Aufträge (nicht erledigt) mit ihren Aufgaben
export const runningJobs = (companyId) =>
  db
    .all('doc', (d) => d.companyId === companyId && d.kind === 'auftrag' && d.status !== 'Erledigt')
    .map((d) => ({ d, items: tasksOf(d.id) }))
    .sort((a, b) => (b.d.date || '').localeCompare(a.d.date || ''));

export const progressBar = (p) =>
  `<div class="tk-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct}"><span style="width:${p.pct}%"></span></div>`;

const itemRow = (t, editable) =>
  `<li class="tk-item ${t.done ? 'done' : ''}" data-tid="${t.id}">
    <label class="tk-check"><input type="checkbox" ${t.done ? 'checked' : ''} data-tk-done></label>
    ${editable ? `<input class="tk-text" value="${esc(t.text)}" data-tk-text aria-label="Aufgabe">` : `<span class="tk-text">${esc(t.text)}</span>`}
    ${editable ? `<button type="button" class="link tk-up" data-tk-up title="nach oben">▲</button><button type="button" class="link danger" data-tk-del title="entfernen">✕</button>` : ''}
  </li>`;

// Kasten im Auftrag: vollständig bearbeitbar
export function taskBoxHtml(d) {
  const items = tasksOf(d.id);
  const p = progress(items);
  return `<section class="tk-box card" id="tkBox">
    <div class="tk-head"><h2>Aufgaben</h2><span class="muted">${p.n ? `${p.done} von ${p.n} erledigt · ${p.pct} %` : 'noch keine Aufgaben'}</span></div>
    ${p.n ? progressBar(p) : ''}
    <ul class="tk-list">${items.map((t) => itemRow(t, true)).join('')}</ul>
    <form class="tk-add" id="tkAdd"><input id="tkNew" placeholder="Neue Aufgabe, z. B. Material bestellen" autocomplete="off"><button class="btn">+ Hinzufügen</button></form>
    <div class="actions"><button type="button" class="btn ai" id="tkAi">✨ Mit KI vorschlagen</button>${p.done ? '<button type="button" class="btn" id="tkClear">Erledigte entfernen</button>' : ''}</div>
    <div id="tkAiOut"></div>
  </section>`;
}

export function wireTaskBox(d, { company, customer, toast, rerender }) {
  const box = document.getElementById('tkBox');
  if (!box) return;
  const items = () => structuredClone(tasksOf(d.id));
  const commit = async (list) => {
    await saveTasks(d, list);
    rerender();
  };
  box.addEventListener('change', async (e) => {
    const li = e.target.closest('[data-tid]');
    if (!li) return;
    const list = items();
    const t = list.find((x) => x.id === li.dataset.tid);
    if (!t) return;
    if (e.target.matches('[data-tk-done]')) {
      t.done = e.target.checked;
      t.doneAt = t.done ? Date.now() : undefined;
      await commit(list);
    } else if (e.target.matches('[data-tk-text]')) {
      const v = e.target.value.trim();
      if (!v) return commit(list.filter((x) => x.id !== t.id));
      t.text = v;
      await saveTasks(d, list);
    }
  });
  box.addEventListener('click', async (e) => {
    const li = e.target.closest('[data-tid]');
    if (!li) return;
    const list = items();
    const i = list.findIndex((x) => x.id === li.dataset.tid);
    if (e.target.matches('[data-tk-del]')) {
      list.splice(i, 1);
      await commit(list);
    } else if (e.target.matches('[data-tk-up]') && i > 0) {
      [list[i - 1], list[i]] = [list[i], list[i - 1]];
      await commit(list);
    }
  });
  box.querySelector('#tkAdd').onsubmit = async (e) => {
    e.preventDefault();
    const inp = box.querySelector('#tkNew');
    const v = inp.value.trim();
    if (!v) return;
    await commit([...items(), { id: uid(), text: v, done: false }]);
    document.getElementById('tkNew')?.focus();
  };
  box.querySelector('#tkClear') &&
    (box.querySelector('#tkClear').onclick = () => commit(items().filter((t) => !t.done)));
  box.querySelector('#tkAi').onclick = async () => {
    const out = box.querySelector('#tkAiOut');
    if (!getAiKey()) {
      out.innerHTML = `<p class="info">Für Vorschläge brauchst du einen API-Schlüssel unter <a href="#/firma/${company.id}">Einstellungen → KI-Assistent</a>. Aufgaben kannst du auch ohne KI oben eintippen.</p>`;
      return;
    }
    const btn = box.querySelector('#tkAi');
    btn.disabled = true;
    btn.textContent = 'KI plant den Auftrag …';
    out.innerHTML = '<p class="muted">Das dauert meist 10 bis 30 Sekunden.</p>';
    try {
      const { suggestTasks } = await import('./ai.js');
      const sug = await suggestTasks({ doc: d, company, customer, existing: items().map((t) => t.text) });
      out.innerHTML = sug.length
        ? `<ul class="tk-sug">${sug.map((t, i) => `<li><label><input type="checkbox" checked data-sg="${i}"> ${esc(t)}</label></li>`).join('')}</ul>
           <div class="actions"><button type="button" class="btn primary" id="tkTake">Ausgewählte übernehmen</button><button type="button" class="btn" id="tkDrop">Verwerfen</button></div>`
        : '<p class="info">Die KI hat keine weiteren Aufgaben gefunden.</p>';
      out.querySelector('#tkDrop') && (out.querySelector('#tkDrop').onclick = () => (out.innerHTML = ''));
      out.querySelector('#tkTake') &&
        (out.querySelector('#tkTake').onclick = async () => {
          const picked = [...out.querySelectorAll('[data-sg]')].filter((c) => c.checked).map((c) => sug[Number(c.dataset.sg)]);
          if (!picked.length) return toast('Nichts ausgewählt', 'err');
          await commit([...items(), ...picked.map((text) => ({ id: uid(), text, done: false }))]);
          toast(picked.length + ' Aufgabe(n) übernommen');
        });
    } catch (e) {
      console.error(e);
      out.innerHTML = `<p class="info err">${esc(e.message)}</p>`;
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Mit KI vorschlagen';
    }
  };
}

// Abhaken direkt in der Übersicht/Aufgabenseite
export async function toggleTask(docId, taskId, done) {
  const d = db.get(docId);
  const list = structuredClone(tasksOf(docId));
  const t = list.find((x) => x.id === taskId);
  if (!d || !t) return;
  t.done = done;
  t.doneAt = done ? Date.now() : undefined;
  await saveTasks(d, list);
}
export const jobItemRow = itemRow;
