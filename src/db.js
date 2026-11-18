// Lokale Datenbank (IndexedDB) mit In-Memory-Cache.
// Jeder Datensatz: { id, type, updatedAt, deleted?, ... }. Gelöschte bleiben als
// "Grabstein" erhalten, damit die Löschung auf andere Geräte synchronisiert wird.
import { uid } from './util.js';

const DB_NAME = 'handwerk-crm';
let idb;
const cache = new Map();
const listeners = new Set();

function req(r) {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function openDb() {
  idb = await new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('records', { keyPath: 'id' });
      d.createObjectStore('files', { keyPath: 'id' });
      d.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const all = await req(idb.transaction('records').objectStore('records').getAll());
  for (const r of all) cache.set(r.id, r);
}

const store = (name, mode = 'readonly') => idb.transaction(name, mode).objectStore(name);

export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (info) => listeners.forEach((fn) => fn(info));

export const get = (id) => {
  const r = cache.get(id);
  return r && !r.deleted ? r : undefined;
};

export const all = (type, filter = () => true) =>
  [...cache.values()].filter((r) => r.type === type && !r.deleted && filter(r));

export const allRaw = () => [...cache.values()];

export async function put(rec, { silent = false, fromSync = false } = {}) {
  const r = { ...rec };
  if (!r.id) r.id = uid();
  if (!fromSync) {
    r.updatedAt = Date.now();
    r._dirty = true;
  }
  cache.set(r.id, r);
  await req(store('records', 'readwrite').put(r));
  if (!silent) emit({ type: r.type, id: r.id, fromSync });
  return r;
}

export async function putMany(recs, opts) {
  const tx = idb.transaction('records', 'readwrite');
  const s = tx.objectStore('records');
  for (const r of recs) {
    cache.set(r.id, r);
    s.put(r);
  }
  await new Promise((res, rej) => ((tx.oncomplete = res), (tx.onerror = () => rej(tx.error))));
  if (!opts?.silent) emit({ bulk: true, fromSync: opts?.fromSync });
}

export async function remove(id) {
  const r = cache.get(id);
  if (!r) return;
  await put({ id: r.id, type: r.type, deleted: true, companyId: r.companyId });
}

// Dateien (Briefkopf, Logos) als Blob
export async function putFile({ id = uid(), name, mime, data }) {
  const f = { id, name, mime, data, synced: false, updatedAt: Date.now() };
  await req(store('files', 'readwrite').put(f));
  return f;
}
export const getFile = (id) => (id ? req(store('files').get(id)) : Promise.resolve(undefined));
export const allFiles = () => req(store('files').getAll());
export const saveFileRaw = (f) => req(store('files', 'readwrite').put(f));

// Key-Value (Einstellungen pro Gerät)
export const getMeta = (k) => req(store('meta').get(k));
export const setMeta = (k, v) => req(store('meta', 'readwrite').put(v, k));

// Komplettexport / -import (Backup)
export async function exportAll() {
  const files = await allFiles();
  const filesOut = [];
  for (const f of files) {
    const buf = new Uint8Array(await f.data.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    filesOut.push({ id: f.id, name: f.name, mime: f.mime, b64: btoa(bin) });
  }
  return { app: 'handwerk-crm', version: 1, exportedAt: new Date().toISOString(), records: allRaw(), files: filesOut };
}

export async function importAll(data) {
  if (data?.app !== 'handwerk-crm') throw new Error('Keine gültige Sicherungsdatei.');
  const merged = [];
  for (const r of data.records) {
    const cur = cache.get(r.id);
    if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) merged.push({ ...r, _dirty: true });
  }
  await putMany(merged);
  for (const f of data.files || []) {
    const bin = atob(f.b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await putFile({ id: f.id, name: f.name, mime: f.mime, data: new Blob([arr], { type: f.mime }) });
  }
  return merged.length;
}
