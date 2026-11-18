const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPad Pro 11'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.stack)); p.on('dialog', (d) => d.accept());
  let req;
  await p.route('https://api.anthropic.com/**', async (route) => {
    req = { headers: route.request().headers(), body: JSON.parse(route.request().postData()) };
    const tplId = req.body.system.match(/"id":"([^"]+)"/)[1];
    const json = JSON.stringify({ note: 'Ventilanzahl angenommen.', positions: [
      { templateId: tplId, title: 'Monteurstunde', desc: 'Arbeitszeit Monteur', qty: 6, unit: 'HUR', price: 58, estimated: false },
      { templateId: null, title: 'Thermostatventil', desc: 'Thermostatventil DN15 liefern und montieren', qty: 2, unit: 'H87', price: 34.5, estimated: true },
    ] });
    const msg = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } };
    const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`;
    const body = ev('message_start', { message: msg }) + ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: json } }) + ev('content_block_stop', { index: 0 }) +
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 50 } }) + ev('message_stop', {});
    await new Promise((r) => setTimeout(r, 500));
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body });
  });
  await p.goto('http://localhost:4173/'); await p.click('text=Firma anlegen');
  await p.fill('[name=name]', 'Muster Gebäudetechnik'); await p.fill('[name=city]', 'Oranienburg');
  await p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  await p.fill('#aiKey', 'sk-ant-test123'); await p.locator('#aiKey').dispatchEvent('change');
  await p.click('button:has-text("Speichern")'); await p.waitForURL(/einstellungen/);
  const synced = await p.evaluate(() => JSON.stringify(Object.keys(localStorage)));
  await p.goto('http://localhost:4173/#/beleg/neu/angebot'); await p.waitForSelector('#addItem');
  await p.click('#addItem'); const it = p.locator('#items .item').first();
  await it.locator('[data-k=desc]').fill('Arbeitszeit Monteur'); await it.locator('[data-k=price]').fill('58'); await it.locator('[data-k=unit]').selectOption('HUR');
  await p.waitForTimeout(400); await p.click('[data-tpl="0"]'); await p.waitForTimeout(400); await p.click('[data-rm="0"]'); await p.waitForTimeout(300);
  const before = await p.locator('#items .item').count();
  await p.click('#aiFill'); await p.waitForSelector('#aiText');
  await p.screenshot({ path: 'test/shots/ai-sheet.png' });
  await p.fill('#aiText', 'Heizkörper im Bad getauscht, 2 Monteure je 3 Stunden, 2 Thermostatventile');
  await p.click('#aiGo'); await p.waitForSelector('#aiTake', { timeout: 15000 });
  await p.screenshot({ path: 'test/shots/ai-result.png' });
  await p.click('#aiTake'); await p.waitForTimeout(800);
  const after = await p.locator('#items .item').count();
  console.log(JSON.stringify({ synced, before, after, model: req?.body.model, fallbacks: req?.body.fallbacks, beta: req?.headers['anthropic-beta'], fmt: req?.body.output_config?.format?.type, key: req?.headers['x-api-key'], errs }, null, 1));
  await p.screenshot({ path: 'test/shots/ai-after.png', fullPage: true });
  await b.close();
})();
