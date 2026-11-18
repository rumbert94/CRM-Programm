const { chromium, devices } = require('playwright');
const U = 'http://localhost:4173/';
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.stack)); p.on('dialog', (d) => d.accept());
  let req;
  await p.route('https://api.anthropic.com/**', async (route) => {
    req = JSON.parse(route.request().postData());
    const json = JSON.stringify({ tasks: ['Aufmaß im Bad nehmen', 'Material beim Großhandel bestellen', 'Termin mit Kundin abstimmen', 'Alten Heizkörper demontieren', 'Neuen Heizkörper montieren und anschließen', 'Anlage befüllen, entlüften, Dichtheit prüfen', 'Abnahme mit Kundin', 'Rechnung schreiben'] });
    const msg = { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
    const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`;
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: ev('message_start', { message: msg }) + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) + ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: json } }) + ev('content_block_stop', { index: 0 }) + ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) + ev('message_stop', {}) });
  });
  await p.goto(U); await p.click('text=Firma anlegen');
  await p.fill('[name=name]', 'Tinus Gebäudetechnik'); await p.fill('[name=city]', 'Oranienburg');
  await p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  await p.fill('#aiKey', 'sk-ant-test'); await p.locator('#aiKey').dispatchEvent('change');
  await p.click('button:has-text("Speichern")'); await p.waitForURL(/einstellungen/);
  for (const n of ['Rosa Sadowska', 'Peter Klein']) {
    await p.goto(U + '#/kunde/neu'); await p.fill('[name=name]', n); await p.fill('[name=city]', 'Oranienburg');
    await p.click('form#f button:has-text("Speichern")'); await p.waitForSelector('#nf');
  }
  const mkJob = async (cust, subj, desc) => {
    await p.goto(U + '#/beleg/neu/auftrag'); await p.waitForSelector('#addItem');
    const opt = await p.locator('[name=customerId] option', { hasText: cust }).first().getAttribute('value');
    await p.selectOption('[name=customerId]', opt); await p.fill('[name=subject]', subj);
    await p.click('#addItem'); await p.locator('#items .item').first().locator('[data-k=desc]').fill(desc); await p.locator('#items .item').first().locator('[data-k=price]').fill('900');
    await p.waitForTimeout(900);
  };
  await mkJob('Rosa', 'Bad, Heizkörpertausch', 'Heizkörper Typ 22 tauschen inkl. Thermostatventil');
  // manuell
  await p.fill('#tkNew', 'Schlüssel bei Nachbarin abholen'); await p.click('#tkAdd button'); await p.waitForTimeout(300);
  // KI
  await p.click('#tkAi'); await p.waitForSelector('#tkTake'); await p.screenshot({ path: 'test/shots/tk-ai.png', fullPage: false });
  await p.locator('[data-sg="7"]').uncheck(); await p.click('#tkTake'); await p.waitForTimeout(400);
  await p.locator('[data-tk-done]').nth(0).check(); await p.waitForTimeout(200);
  await p.locator('[data-tk-done]').nth(1).check(); await p.waitForTimeout(200);
  await p.locator('[data-tk-text]').nth(2).fill('Material bei GC bestellen'); await p.locator('[data-tk-text]').nth(2).blur(); await p.waitForTimeout(300);
  await p.locator('#tkBox').scrollIntoViewIfNeeded(); await p.locator('#tkBox').screenshot({ path: 'test/shots/tk-box.png' });
  const boxCount = await p.locator('#tkBox .tk-item').count();
  // reload persists
  await p.reload(); await p.waitForSelector('#tkBox'); const after = await p.locator('#tkBox .tk-item').count(); const edited = await p.locator('[data-tk-text]').nth(2).inputValue();
  await mkJob('Peter', 'Wartung Gastherme', 'Wartung Gas-Brennwertgerät');
  await p.goto(U + '#/aufgaben'); await p.waitForTimeout(400);
  const groups1 = await p.locator('.tk-group').count();
  await p.click('[data-tk-f="alle"]'); await p.waitForTimeout(200); const groups2 = await p.locator('.tk-group').count();
  await p.locator('.tk-group [data-tk-done]').nth(2).check(); await p.waitForTimeout(400);
  const pill = await p.locator('.tk-group .pill').first().innerText();
  await p.screenshot({ path: 'test/shots/tk-page.png', fullPage: true });
  await p.goto(U + '#/'); await p.waitForTimeout(400); const card = await p.locator('.dash-card', { hasText: 'Laufende Aufträge' }).innerText();
  await p.locator('.dash-card', { hasText: 'Laufende Aufträge' }).screenshot({ path: 'test/shots/tk-dash.png' });
  console.log(JSON.stringify({ boxCount, after, edited, groups1, groups2, pill, card, sys: req?.system.slice(0, 60), user: req?.messages[0].content, errs }, null, 1));
  await b.close();
})();
