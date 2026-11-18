// End-to-End-Test: Firma, Kunde, Notiz, Angebot -> Rechnung, abschließen, ZUGFeRD
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:4173/');
  await p.click('text=Firma anlegen');
  const fill = async (n, v) => p.fill(`[name="${n}"]`, v);
  await fill('name', 'Muster Haustechnik GmbH'); await fill('owner', 'Max Muster'); await fill('street', 'Werkstraße 5');
  await fill('zip', '12345'); await fill('city', 'Musterstadt'); await fill('phone', '+49 123 45678'); await fill('email', 'info@muster.de');
  await fill('vatId', 'DE123456789'); await fill('taxNumber', '12/345/67890'); await fill('iban', 'DE02120300000000202051'); await fill('bic', 'BYLADEM1001'); await fill('bankName', 'DKB');
  await p.screenshot({ path: 'test/shots/1-firma.png', fullPage: false });
  await p.click('button:has-text("Speichern")');
  await p.waitForURL(/einstellungen/);
  await p.click('nav >> text=Kunden');
  await p.click('text=+ Neuer Kunde');
  await fill('name', 'Erika Mustermann'); await fill('street', 'Hauptstraße 1'); await fill('zip', '54321'); await fill('city', 'Beispielhausen'); await fill('email', 'erika@example.com'); await fill('phone', '0151 123456');
  await p.click('form#f button:has-text("Speichern")');
  await p.waitForSelector('#nf');
  await p.fill('#nf textarea', 'Aufmaß Bad am 12.11. – Fliesen weiß, Dusche bodengleich.');
  await p.click('#nf button');
  await p.waitForSelector('.notes li p');
  await p.screenshot({ path: 'test/shots/2-kunde.png', fullPage: true });
  await p.click('text=+ Angebot');
  await p.fill('[name=subject]', 'Badsanierung Hauptstraße 1');
  for (const [t, q, u, pr] of [['Arbeitszeit Geselle', '16', 'HUR', '58'], ['Fliesen verlegen', '12,5', 'MTK', '45,90'], ['Material pauschal', '1', 'LS', '380']]) {
    await p.click('#addItem');
    const it = p.locator('#items .item').last();
    await it.locator('[data-k=title]').fill(t);
    await it.locator('[data-k=qty]').fill(q);
    await it.locator('[data-k=unit]').selectOption(u);
    await it.locator('[data-k=price]').fill(pr);
  }
  await p.waitForTimeout(1200);
  await p.screenshot({ path: 'test/shots/3-angebot.png', fullPage: true });
  const totalA = await p.textContent('#totals .grand b');
  await p.click('#toRechnung');
  await p.waitForSelector('#finalize');
  await p.click('#finalize');
  await p.waitForSelector('#zugferd');
  const nr = await p.textContent('h1');
  await p.screenshot({ path: 'test/shots/4-rechnung.png', fullPage: true });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#zugferd')]);
  await dl.saveAs('test/out/e2e-zugferd.pdf');
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#xrechnung')]);
  await dl2.saveAs('test/out/e2e-xrechnung.xml');
  await p.click('nav >> text=Übersicht');
  await p.screenshot({ path: 'test/shots/5-uebersicht.png' });
  // Desktop-Ansicht
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.click('nav >> text=Rechnungen');
  await p.screenshot({ path: 'test/shots/6-desktop.png' });
  // Persistenz nach Reload
  await p.reload();
  await p.click('nav >> text=Kunden');
  const n = await p.locator('.list li').count();
  console.log({ totalA, nr, kundenNachReload: n, errors });
  await b.close();
})();
