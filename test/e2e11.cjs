const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.stack));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:4173/'); await p.click('text=Firma anlegen');
  await p.fill('[name=name]', 'Muster Gebäudetechnik'); await p.fill('[name=street]', 'Werkweg 3'); await p.fill('[name=zip]', '16515'); await p.fill('[name=city]', 'Oranienburg');
  await p.click('button:has-text("Speichern")'); await p.waitForURL(/einstellungen/);
  for (const [n, price] of [['Hofladen Susanne', 122.2], ['Jonas Frank', 480], ['Café Rosengarten', 91.75]]) {
    await p.goto('http://localhost:4173/#/kunde/neu'); await p.fill('[name=name]', n); await p.fill('[name=city]', 'Berlin'); await p.fill('[name=street]', 'Weg 1'); await p.fill('[name=zip]', '13467');
    await p.click('form#f button:has-text("Speichern")'); await p.waitForSelector('#nf');
    await p.click('text=+ Rechnung'); await p.click('#addItem'); await p.locator('[data-k=desc]').fill('Wartung'); await p.locator('[data-k=price]').fill(String(price));
    await p.fill('[name=subject]', 'Heizungswartung'); await p.waitForTimeout(1200);
    if (n !== 'Jonas Frank') { await p.click('#finalize'); await p.waitForTimeout(800); }
  }
  await p.goto('http://localhost:4173/#/belege/rechnung'); await p.waitForTimeout(600);
  await p.screenshot({ path: 'test/shots/design-rechnungen.png' });
  await p.goto('http://localhost:4173/#/kunden'); await p.waitForTimeout(400);
  await p.screenshot({ path: 'test/shots/design-kunden.png' });
  await p.goto('http://localhost:4173/#/'); await p.waitForTimeout(400);
  await p.screenshot({ path: 'test/shots/design-home.png' });
  await p.click('#themeBtn'); await p.goto('http://localhost:4173/#/belege/rechnung'); await p.waitForTimeout(400);
  await p.screenshot({ path: 'test/shots/design-dark.png' });
  await p.click('#themeBtn');
  await p.setViewportSize({ width: 412, height: 900 }); await p.waitForTimeout(400);
  await p.screenshot({ path: 'test/shots/design-mobile.png' });
  await p.goto('http://localhost:4173/#/'); await p.waitForTimeout(400);
  await p.screenshot({ path: 'test/shots/design-home-mobile.png' });
  console.log({ errs });
  await b.close();
})();
