const { chromium, devices } = require('playwright');
const draw = async (p) => {
  const c = await p.locator('#sgPad').boundingBox();
  await p.mouse.move(c.x + 40, c.y + c.height * 0.6); await p.mouse.down();
  for (let i = 0; i <= 30; i++) await p.mouse.move(c.x + 40 + i * 8, c.y + c.height * 0.6 + Math.sin(i / 3) * 30);
  await p.mouse.up();
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPad Pro 11'], acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.stack)); p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:4173/'); await p.click('text=Firma anlegen');
  await p.fill('[name=name]', 'Muster Gebäudetechnik'); await p.fill('[name=street]', 'Werkweg 3'); await p.fill('[name=zip]', '16515'); await p.fill('[name=city]', 'Oranienburg');
  await p.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  await p.fill('[name="regie.rate"]', '55');
  await p.click('button:has-text("Speichern")'); await p.waitForURL(/einstellungen/);
  await p.goto('http://localhost:4173/#/monteure'); await p.waitForSelector('#newW');
  for (const [n, r] of [['Max Meister', '68'], ['Tom Azubi', '']]) {
    await p.click('#newW'); await p.fill('#wf [name=name]', n); await p.fill('#wf [name=rate]', r); await p.click('#wf button.primary'); await p.waitForTimeout(300);
  }
  await p.screenshot({ path: 'test/shots/monteure.png' });
  await p.goto('http://localhost:4173/#/kunde/neu'); await p.fill('[name=name]', 'Rosa Sadowska'); await p.fill('[name=city]', 'Oranienburg');
  await p.click('form#f button:has-text("Speichern")'); await p.waitForSelector('#nf');
  await p.goto('http://localhost:4173/#/bericht/neu'); await p.waitForSelector('#rf');
  const firstW = await p.inputValue('.w-name');
  await p.selectOption('[name=customerId]', { label: 'Rosa Sadowska (Oranienburg)' });
  await p.fill('[name=date]', '2026-12-25'); await p.locator('[name=date]').dispatchEvent('change'); await p.waitForTimeout(300);
  const sur = await p.evaluate(() => document.querySelector('[name=surcharge]:checked')?.value);
  await p.fill('[name=start]', '08:00'); await p.fill('[name=end]', '10:00');
  await p.click('#addW'); await p.locator('.w-name').nth(1).fill('Tom Azubi');
  await p.locator('.i-desc').first().fill('Rohrbruch notdicht');
  await p.waitForTimeout(800);
  await p.click('#signCust'); await p.waitForSelector('#sgPad'); await draw(p); await p.click('#sgOk'); await p.waitForTimeout(600);
  await p.fill('[name=internalNote]', 'Material nachberechnen'); await p.waitForTimeout(900);
  await p.reload(); await p.waitForSelector('#rf');
  const note = await p.inputValue('[name=internalNote]');
  const stillSigned = await p.locator('.sig-done').count();
  await p.screenshot({ path: 'test/shots/rb-ipad.png', fullPage: true });
  await p.click('#toInv'); await p.waitForURL(/beleg\//); await p.waitForTimeout(800);
  const descs = await p.locator('[data-k=desc]').evaluateAll((els) => els.map((e) => e.value));
  const prices = await p.locator('[data-k=price]').evaluateAll((els) => els.map((e) => e.value));
  console.log({ firstW, sur, note, stillSigned, descs, prices, errs });
  await b.close();
})();
