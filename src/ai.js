// KI-Assistent: Positionen für Angebote/Rechnungen aus einer Beschreibung vorschlagen.
// Der API-Schlüssel liegt nur im Browser dieses Geräts (localStorage), nie im Code oder in der Cloud-Synchronisation.
import Anthropic from '@anthropic-ai/sdk';
import { UNITS, unitLabel } from './util.js';
import { getAiKey } from './ai-key.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['positions', 'note'],
  properties: {
    positions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['templateId', 'title', 'desc', 'qty', 'unit', 'price', 'estimated'],
        properties: {
          templateId: { type: ['string', 'null'], description: 'ID der verwendeten Vorlage oder null' },
          title: { type: 'string', description: 'Kurzer Positionstitel' },
          desc: { type: 'string', description: 'Leistungsbeschreibung, wie sie auf dem Beleg stehen soll' },
          qty: { type: 'number' },
          unit: { type: 'string', enum: UNITS.map((u) => u.code) },
          price: { type: 'number', description: 'Einzelpreis netto in Euro' },
          estimated: { type: 'boolean', description: 'true, wenn der Preis geschätzt ist (keine Vorlage)' },
        },
      },
    },
    note: { type: 'string', description: 'Kurzer Hinweis an den Handwerker, z. B. Annahmen oder offene Fragen; leer wenn nichts' },
  },
};

export async function suggestPositions({ text, kind, templates, company, customer }) {
  const apiKey = getAiKey();
  if (!apiKey) throw new Error('Kein API-Schlüssel hinterlegt (Einstellungen → KI-Assistent).');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const tpl = templates.slice(0, 400).map((a) => ({
    id: a.id,
    group: a.group || '',
    title: a.title || '',
    desc: (a.desc || '').slice(0, 300),
    unit: a.unit,
    price: Number(a.price) || 0,
  }));
  const units = UNITS.map((u) => `${u.code} = ${u.label}`).join(', ');
  const system = `Du hilfst einem Handwerksbetrieb (${company.name || 'Gebäudetechnik'}) beim Erstellen von ${kind === 'rechnung' ? 'Rechnungen' : kind === 'auftrag' ? 'Auftragsbestätigungen' : 'Angeboten'}.
Aus der Beschreibung des Handwerkers erstellst du die passenden Belegpositionen.
- Nutze bevorzugt die Vorlagen des Betriebs (Liste unten). Übernimm dann deren ID, Einheit und Preis, und passe nur Menge und ggf. die Beschreibung an.
- Gibt es keine passende Vorlage, formuliere die Position selbst, setze templateId auf null, schätze einen üblichen Nettopreis in Deutschland und setze estimated auf true.
${company.regie?.rate ? `- Der Stundensatz des Betriebs ist ${company.regie.rate} € netto.\n` : ''}- Arbeitszeit, Anfahrt und Material jeweils als eigene Positionen. Erfinde keine Leistungen, die nicht beschrieben sind.
- Schreibe knapp und fachlich korrekt auf Deutsch, so wie es auf einem Beleg stehen würde.
- Einheiten: ${units}.
- In note kurz Annahmen oder fehlende Angaben nennen.

Vorlagen des Betriebs (JSON):
${JSON.stringify(tpl)}`;
  const user = `${customer?.name ? `Kunde: ${customer.name}\n` : ''}Beschreibung:\n${text}`;

  const data = await askJson(client, system, user, SCHEMA);
  const byId = new Map(templates.map((a) => [a.id, a]));
  data.positions = data.positions.map((p) => ({ ...p, template: p.templateId ? byId.get(p.templateId) || null : null }));
  return data;
}

async function askJson(client, system, user, schema) {
  const stream = client.beta.messages.stream({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } },
  });
  let msg;
  try {
    msg = await stream.finalMessage();
  } catch (e) {
    const s = e?.status;
    if (s === 401) throw new Error('Der API-Schlüssel ist ungültig.');
    if (s === 400 && /credit|balance/i.test(e.message)) throw new Error('Kein Guthaben im Anthropic-Konto. Bitte in der Console Guthaben aufladen.');
    if (s === 429) throw new Error('Zu viele Anfragen – bitte kurz warten.');
    if (s === 529 || s >= 500) throw new Error('Der KI-Dienst ist gerade überlastet. Bitte gleich nochmal versuchen.');
    throw new Error(e?.message || 'Verbindung zur KI fehlgeschlagen.');
  }
  if (msg.stop_reason === 'refusal') throw new Error('Die KI hat die Anfrage abgelehnt.');
  if (msg.stop_reason === 'max_tokens') throw new Error('Die Antwort war zu lang. Bitte die Beschreibung aufteilen.');
  const out = msg.content.find((b) => b.type === 'text')?.text;
  if (!out) throw new Error('Keine Antwort von der KI erhalten.');
  return JSON.parse(out);
}

// Aufgabenliste für einen Auftrag aus Betreff und Positionen
const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: { tasks: { type: 'array', items: { type: 'string', description: 'Eine konkrete Aufgabe, kurz, mit Verb' } } },
};
export async function suggestTasks({ doc, company, customer, existing = [] }) {
  const apiKey = getAiKey();
  if (!apiKey) throw new Error('Kein API-Schlüssel hinterlegt (Einstellungen → KI-Assistent).');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const items = (doc.items || [])
    .filter((i) => i.type !== 'title')
    .map((i) => `- ${i.qty || ''} ${i.unit ? unitLabel(i.unit) : ''} ${[i.title, i.desc].filter(Boolean).join(': ')}`.trim())
    .join('\n');
  const system = `Du planst für einen Handwerksbetrieb (${company.name || 'Gebäudetechnik'}) die Abarbeitung eines Auftrags.
Erstelle eine praktische To-do-Liste in der Reihenfolge, in der die Arbeit abläuft: Vorbereitung (z. B. Aufmaß, Material bestellen, Termin mit dem Kunden abstimmen), Ausführung (je Leistung ein Schritt, gleichartige zusammenfassen), Abschluss (z. B. Prüfung/Abnahme, Baustelle räumen, Regiebericht/Dokumentation, Rechnung schreiben).
- 5 bis 15 Aufgaben, jede kurz (höchstens 10 Wörter), auf Deutsch, mit Verb.
- Nur was zum Auftrag passt; nichts erfinden, was nicht naheliegt.
- Bereits vorhandene Aufgaben nicht wiederholen.`;
  const user = `${customer?.name ? `Kunde: ${customer.name}\n` : ''}${doc.subject ? `Betreff/Bauvorhaben: ${doc.subject}\n` : ''}Positionen:\n${items || '(keine)'}${existing.length ? `\n\nSchon vorhandene Aufgaben:\n${existing.map((t) => '- ' + t).join('\n')}` : ''}`;
  const data = await askJson(client, system, user, TASK_SCHEMA);
  return data.tasks.map((t) => t.trim()).filter(Boolean);
}
