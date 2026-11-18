const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:4173/'); await p.click('text=Firma anlegen');
  await p.fill('[name=name]', 'Muster Gebäudetechnik'); await p.fill('[name=street]', 'Werkweg 3'); await p.fill('[name=zip]', '16515'); await p.fill('[name=city]', 'Oranienburg');
  await p.click('button:has-text("Speichern")'); await p.waitForURL(/einstellungen/);
  await p.click('nav >> text=Kunden'); await p.click('text=+ Neuer Kunde'); await p.fill('[name=name]', 'Erika Muster'); await p.fill('[name=city]', 'Berlin');
  await p.click('form#f button:has-text("Speichern")'); await p.waitForSelector('#nf');
  await p.click('text=+ Angebot');
  await p.click('#addItem'); await p.locator('[data-k=desc]').fill('Heizungswartung inkl. Abgasmessung'); await p.locator('[data-k=price]').fill('189');
  await p.waitForSelector('#pvBody canvas', { timeout: 20000 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: 'test/shots/h1-desktop.png' });
  await p.fill('[name=subject]', 'Wartung 2026 – geändert');
  await p.waitForTimeout(2500);
  const state = await p.textContent('#pvState');
  // Handy
  await p.setViewportSize({ width: 412, height: 915 });
  await p.click('#pvFab'); await p.waitForTimeout(2500);
  await p.screenshot({ path: 'test/shots/h2-mobile.png' });
  console.log({ state, errs });
  await b.close();
})();
