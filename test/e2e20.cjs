const { chromium } = require('playwright');
const U = 'http://localhost:4173/';
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.stack)); p.on('dialog', (d) => d.accept());
  await p.goto(U); await p.click('text=Firma anlegen');
  await p.fill('[name=name]', 'Tinus Gebäudetechnik'); await p.fill('[name=city]', 'Oranienburg');
  await p.click('button:has-text("Speichern")'); await p.waitForURL(/einstellungen/);
  await p.goto(U + '#/'); await p.waitForTimeout(400);
  // Gruppe Stammdaten zuklappen
  await p.click('.nav-group[data-grp="Stammdaten"]'); await p.waitForTimeout(200);
  const hiddenAfter = await p.locator('nav a[data-k="kunden"]').isVisible();
  await p.reload(); await p.waitForTimeout(400);
  const stillClosed = !(await p.locator('nav a[data-k="kunden"]').isVisible());
  await p.screenshot({ path: 'test/shots/nav-groups.png' });
  // ganze Leiste einklappen
  await p.click('#collapseBtn'); await p.waitForTimeout(300);
  const w = await p.locator('#sideNav').evaluate((e) => e.getBoundingClientRect().width);
  await p.screenshot({ path: 'test/shots/nav-collapsed.png' });
  await p.reload(); await p.waitForTimeout(400);
  const w2 = await p.locator('#sideNav').evaluate((e) => e.getBoundingClientRect().width);
  await p.click('nav a[data-k="kunden"]'); await p.waitForTimeout(300); const url = p.url();
  await p.click('#collapseBtn'); await p.waitForTimeout(300);
  const w3 = await p.locator('#sideNav').evaluate((e) => e.getBoundingClientRect().width);
  console.log(JSON.stringify({ hiddenAfter, stillClosed, w, w2, url, w3, errs }));
  await b.close();
})();
