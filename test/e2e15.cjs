const { chromium, devices } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPad Pro 11'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.stack));
  let promptAns = 'Heizungstechnik';
  p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(promptAns) : d.accept()));
  await p.goto('http://localhost:4173/'); await p.click('text=Firma anlegen');
  await p.fill('[name=name]', 'Muster Gebäudetechnik'); await p.fill('[name=city]', 'Oranienburg');
  await p.click('button:has-text("Speichern")'); await p.waitForURL(/einstellungen/);
  await p.goto('http://localhost:4173/#/vorlagen'); await p.waitForSelector('#newTpl');
  for (const [t, g, pr] of [['Heizkörper tauschen', 'Heizung', '180'], ['Thermostatventil', 'Heizung', '34,50'], ['WC montieren', 'Sanitär', '120'], ['Monteurstunde', '', '58'], ['Anfahrt', '', '25']]) {
    await p.click('#newTpl'); await p.fill('#tf [name=title]', t); await p.fill('#tf [name=group]', g); await p.fill('#tf [name=price]', pr);
    await p.click('#tf button.primary'); await p.waitForTimeout(300);
  }
  const heads1 = await p.locator('.group-head b').allTextContents();
  // mehrere zuordnen
  await p.click('#selMode'); await p.waitForSelector('#selApply');
  for (const t of ['Monteurstunde', 'Anfahrt']) await p.locator('.sel-row', { hasText: t }).locator('input').check();
  await p.fill('#selGrp', 'Allgemein'); await p.click('#selApply'); await p.waitForTimeout(400);
  await p.click('#selMode'); await p.waitForTimeout(300);
  await p.click('[data-ren="Heizung"]'); await p.waitForTimeout(400);
  const heads2 = await p.locator('.group-head b').allTextContents();
  await p.screenshot({ path: 'test/shots/tpl-groups.png', fullPage: true });
  await p.click('[data-grp="Sanitär"]'); await p.waitForTimeout(300);
  const filtered = await p.locator('.row-main b').allTextContents();
  await p.goto('http://localhost:4173/#/beleg/neu/angebot'); await p.waitForSelector('#fromTpl');
  await p.click('#fromTpl'); await p.waitForSelector('#tplList');
  const sub = await p.locator('#tplList .subhead').allTextContents();
  await p.screenshot({ path: 'test/shots/tpl-pick.png' });
  await p.click('[data-pg="Heizungstechnik"]'); await p.waitForTimeout(200);
  const pickList = await p.locator('#tplList [data-id] b').allTextContents();
  await p.locator('#tplList [data-id]').first().click(); await p.waitForTimeout(400);
  console.log(JSON.stringify({ heads1, heads2, filtered, sub, pickList, items: await p.locator('#items .item').count(), errs }, null, 1));
  await b.close();
})();
