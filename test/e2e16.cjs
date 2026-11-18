const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.stack)); p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:4173/'); await p.click('text=Firma anlegen');
  await p.fill('[name=name]', 'Tinus Gebäudetechnik'); await p.fill('[name=city]', 'Oranienburg');
  await p.click('button:has-text("Speichern")'); await p.waitForURL(/einstellungen/);
  for (const n of ['Rosa Sadowska', 'Bauhaus Wohnen GmbH', 'Peter Klein']) {
    await p.goto('http://localhost:4173/#/kunde/neu'); await p.fill('[name=name]', n); await p.fill('[name=city]', 'Oranienburg');
    await p.click('form#f button:has-text("Speichern")'); await p.waitForSelector('#nf');
  }
  for (const [k, c, d, pr] of [['angebot', 'Rosa', 'Bad sanieren', '4200'], ['rechnung', 'Peter', 'Heizungswartung', '310'], ['auftrag', 'Bauhaus', 'Heizkörper tauschen', '1800']]) {
    await p.goto('http://localhost:4173/#/beleg/neu/' + k); await p.waitForSelector('#addItem');
    const opt = await p.locator('[name=customerId] option', { hasText: c }).first().getAttribute('value');
    await p.selectOption('[name=customerId]', opt);
    await p.click('#addItem'); const it = p.locator('#items .item').first();
    await it.locator('[data-k=desc]').fill(d); await it.locator('[data-k=price]').fill(pr); await p.waitForTimeout(900);
  }
  const shot = async (url, name, dark) => { await p.emulateMedia({ colorScheme: dark ? 'dark' : 'light' }); await p.goto('http://localhost:4173/' + url); await p.waitForTimeout(500); await p.screenshot({ path: 'test/shots/' + name + '.png' }); };
  await shot('#/', 'farbig-home'); await shot('#/kunden', 'farbig-kunden'); await shot('#/', 'farbig-home-dark', true);
  // umschalten auf klassisch
  await p.emulateMedia({ colorScheme: 'light' });
  await p.goto('http://localhost:4173/#/einstellungen'); await p.waitForTimeout(400);
  await p.locator('a', { hasText: 'Tinus' }).first().click().catch(() => {}); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  await p.selectOption('[name=uiColors]', 'klassisch'); await p.click('button:has-text("Speichern")'); await p.waitForTimeout(500);
  await shot('#/', 'klassisch-home');
  const mode = await p.evaluate(() => document.documentElement.dataset.colors);
  const m = await b.newContext({ ...devices['Pixel 7'] }); const q = await m.newPage();
  console.log(JSON.stringify({ mode, errs }));
  await b.close();
})();
