// API-Schlüssel für den KI-Assistenten: nur im Browser dieses Geräts (localStorage),
// nie im Code, nie in der OneDrive-Synchronisation.
const KEY = 'anthropicKey';
export const getAiKey = () => {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
};
export const setAiKey = (k) => {
  try { k?.trim() ? localStorage.setItem(KEY, k.trim()) : localStorage.removeItem(KEY); } catch {}
};
