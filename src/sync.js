// Synchronisation mit OneDrive (App-Ordner "Apps/<App-Name>") über Microsoft Graph.
// Alle Datensätze liegen in einer Datei crm-data.json; Konflikte werden pro
// Datensatz nach "zuletzt geändert gewinnt" aufgelöst. Dateien (Briefköpfe)
// liegen einzeln unter dateien/<id>. Rechnungs-PDFs können unter Belege/ abgelegt werden.
import { PublicClientApplication } from '@azure/msal-browser';
import * as db from './db.js';
import { safeFile } from './util.js';

const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';
const SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read'];
const DATA_FILE = 'crm-data.json';

export const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');

let pca;
let account;
let syncing = false;
let pending = false;
const state = { status: 'aus', message: 'OneDrive nicht verbunden', lastSync: null };
const listeners = new Set();
export const onStatus = (fn) => (listeners.add(fn), fn(state), () => listeners.delete(fn));
const setState = (p) => {
  Object.assign(state, p);
  listeners.forEach((fn) => fn(state));
};
export const getState = () => state;

export async function getClientId() {
  return (await db.getMeta('msClientId')) || import.meta.env?.VITE_MS_CLIENT_ID || '';
}

export async function init() {
  const clientId = await getClientId();
  if (!clientId) return;
  const redirectUri = appUrl();
  pca = new PublicClientApplication({
    auth: { clientId, authority: 'https://login.microsoftonline.com/common', redirectUri },
    cache: { cacheLocation: 'localStorage' },
  });
  await pca.initialize();
  try {
    const res = await pca.handleRedirectPromise();
    if (res?.account) pca.setActiveAccount(res.account);
  } catch (e) {
    setState({ status: 'fehler', message: 'Anmeldung fehlgeschlagen: ' + e.message });
  }
  account = pca.getActiveAccount() || pca.getAllAccounts()[0];
  if (account) {
    pca.setActiveAccount(account);
    setState({ status: 'bereit', message: 'Verbunden als ' + account.username, user: account.username });
    sync();
  }
}

export const isConnected = () => !!account;

export async function login() {
  if (!pca) await init();
  if (!pca) throw new Error('Bitte zuerst die Client-ID der App-Registrierung eintragen.');
  await pca.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
}

export async function logout() {
  if (!pca || !account) return;
  const a = account;
  account = null;
  setState({ status: 'aus', message: 'OneDrive nicht verbunden', user: null });
  await pca.logoutRedirect({ account: a, postLogoutRedirectUri: appUrl() });
}

async function token() {
  try {
    const r = await pca.acquireTokenSilent({ scopes: SCOPES, account });
    return r.accessToken;
  } catch (e) {
    setState({ status: 'fehler', message: 'Anmeldung abgelaufen, bitte neu verbinden.' });
    await pca.acquireTokenRedirect({ scopes: SCOPES, account });
    throw e;
  }
}

async function graph(path, opts = {}) {
  const t = await token();
  const res = await fetch(GRAPH + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) },
  });
  return res;
}

const strip = (r) => {
  const { _dirty, ...rest } = r;
  return rest;
};

export const scheduleSync = (() => {
  let t;
  return () => {
    if (!account) return;
    clearTimeout(t);
    t = setTimeout(sync, 2500);
  };
})();

export async function sync() {
  if (!account || !navigator.onLine) {
    if (account) setState({ status: 'offline', message: 'Offline – Änderungen werden später übertragen' });
    return;
  }
  if (syncing) {
    pending = true;
    return;
  }
  syncing = true;
  setState({ status: 'läuft', message: 'Synchronisiere …' });
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (await syncOnce()) break;
    }
    await syncFiles();
    setState({ status: 'ok', message: 'Synchronisiert', lastSync: Date.now() });
  } catch (e) {
    console.error(e);
    setState({ status: 'fehler', message: 'Sync-Fehler: ' + e.message });
  } finally {
    syncing = false;
    if (pending) {
      pending = false;
      setTimeout(sync, 500);
    }
  }
}

// Liefert true bei Erfolg, false bei Konflikt (Datei wurde zwischenzeitlich geändert)
async function syncOnce() {
  const meta = await graph(`:/${DATA_FILE}`);
  let remote = [];
  let eTag = null;
  if (meta.ok) {
    const m = await meta.json();
    eTag = m.eTag;
    const content = await fetch(m['@microsoft.graph.downloadUrl']);
    remote = (await content.json()).records || [];
  } else if (meta.status !== 404) {
    throw new Error('OneDrive antwortet mit ' + meta.status);
  }

  // Remote -> lokal
  const incoming = [];
  const remoteIds = new Map(remote.map((r) => [r.id, r]));
  for (const r of remote) {
    const local = db.allRaw().find((x) => x.id === r.id);
    if (!local || (r.updatedAt || 0) > (local.updatedAt || 0)) incoming.push({ ...r, _dirty: false });
  }
  if (incoming.length) await db.putMany(incoming, { fromSync: true });

  // Lokal -> remote nötig?
  const snapshot = db.allRaw();
  const needUpload = !meta.ok || snapshot.some((l) => {
    const r = remoteIds.get(l.id);
    return !r || (l.updatedAt || 0) > (r.updatedAt || 0);
  });
  if (!needUpload) {
    const clean = snapshot.filter((l) => l._dirty).map((l) => ({ ...l, _dirty: false }));
    if (clean.length) await db.putMany(clean, { silent: true });
    return true;
  }

  const body = JSON.stringify({ app: 'handwerk-crm', version: 1, savedAt: new Date().toISOString(), records: snapshot.map(strip) });
  const put = await graph(`:/${DATA_FILE}:/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(eTag ? { 'If-Match': eTag } : { 'If-None-Match': '*' }) },
    body,
  });
  if (put.status === 412 || put.status === 409) return false;
  if (!put.ok) throw new Error('Hochladen fehlgeschlagen (' + put.status + ')');
  // Nur die Datensätze als sauber markieren, die sich seitdem nicht geändert haben
  const sent = new Map(snapshot.map((s) => [s.id, s.updatedAt]));
  const clean = db
    .allRaw()
    .filter((l) => l._dirty && sent.get(l.id) === l.updatedAt)
    .map((l) => ({ ...l, _dirty: false }));
  if (clean.length) await db.putMany(clean, { silent: true });
  return true;
}

async function syncFiles() {
  const files = await db.allFiles();
  for (const f of files.filter((x) => !x.synced)) {
    const r = await graph(`:/dateien/${f.id}:/content`, { method: 'PUT', headers: { 'Content-Type': f.mime }, body: f.data });
    if (r.ok) await db.saveFileRaw({ ...f, synced: true });
  }
  const have = new Set(files.map((f) => f.id));
  const needed = db.all('company').map((c) => c.letterheadFileId).filter((id) => id && !have.has(id));
  for (const id of needed) {
    const meta = await graph(`:/dateien/${id}`);
    if (!meta.ok) continue;
    const m = await meta.json();
    const blob = await (await fetch(m['@microsoft.graph.downloadUrl'])).blob();
    await db.saveFileRaw({ id, name: m.name, mime: m.file?.mimeType || blob.type, data: blob, synced: true, updatedAt: Date.now() });
  }
}

// Beleg (PDF/XML) im OneDrive-Ordner Belege/<Firma>/ ablegen
export async function archive(companyName, fileName, bytes, mime) {
  if (!account) throw new Error('OneDrive ist nicht verbunden.');
  const path = `Belege/${safeFile(companyName)}/${safeFile(fileName)}`;
  const r = await graph(`:/${encodeURI(path)}:/content`, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes });
  if (!r.ok) throw new Error('Ablage fehlgeschlagen (' + r.status + ')');
  return path;
}
