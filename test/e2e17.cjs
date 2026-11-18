const { chromium, devices } = require('playwright');
const U = 'http://localhost:5174/';
async function setup(p) {
  await p.goto(U); await p.click('text=Firma anlegen');
  await p.fill('[name=name]', 'Tinus Gebäudetechnik'); await p.fill('[name=city]', 'Oranienburg');
  await p.click('button:has-text("Speichern")'); await p.waitForURL(/einstellungen/);
  await p.evaluate(async () => {
    const db = await import('/src/db.js');
    const companyId = localStorage.getItem('companyId');
    const names = ['Rosa Sadowska', 'Bauhaus Wohnen GmbH', 'Peter Klein', 'WBG Oranienburg eG', 'Familie Neumann', 'Autohaus Kremer'];
    const cust = [];
    for (const [i, n] of names.entries()) cust.push(await db.put({ type: 'customer', companyId, name: n, city: 'Oranienburg', number: 'K-' + (1001 + i) }));
    let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const pad = (n) => String(n).padStart(2, '0');
    for (const y of [2025, 2026]) for (let m = 1; m <= (y === 2026 ? 11 : 12); m++) {
      const n = 2 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const day = Math.min(28, 1 + Math.floor(rnd() * 27));
        if (y === 2026 && m === 11 && day > 18) continue;
        const date = `${y}-${pad(m)}-${pad(day)}`;
        const due = new Date(Date.parse(date) + 14 * 864e5).toISOString().slice(0, 10);
        const c = cust[Math.floor(rnd() * rnd() * cust.length)];
        const paid = y === 2025 || m < 9 || rnd() > 0.5;
        await db.put({ type: 'doc', kind: 'rechnung', companyId, customerId: c.id, customerSnapshot: { name: c.name }, number: `${String(y).slice(2)}${pad(m)}${k}`, date, dueDate: due, locked: true, status: paid ? 'Bezahlt' : 'Versendet',
          items: [{ id: 'i' + k, desc: 'Leistung', qty: '1', unit: 'LS', price: String(Math.round((400 + rnd() * 2600 * (y === 2026 ? 1.15 : 1)) * 100) / 100), vat: 19 }] });
      }
    }
    for (const [st, k] of [['Angenommen', 7], ['Abgelehnt', 3], ['Versendet', 2]]) for (let i = 0; i < k; i++)
      await db.put({ type: 'doc', kind: 'angebot', companyId, customerId: cust[0].id, date: '2026-0' + (1 + i % 9) + '-10', status: st, items: [{ id: 'a', desc: 'x', qty: '1', unit: 'LS', price: '1000', vat: 19 }] });
  });
}
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.stack)); p.on('dialog', (d) => d.accept());
  await setup(p);
  const shot = async (name, dark, pg = p) => { await pg.emulateMedia({ colorScheme: dark ? 'dark' : 'light' }); await pg.goto(U + '#/'); await pg.waitForTimeout(600); await pg.locator('.dash-kpis').scrollIntoViewIfNeeded(); await pg.waitForTimeout(200); await pg.screenshot({ path: 'test/shots/' + name + '.png', fullPage: true }); };
  await shot('dash-hell');
  await p.locator('.mchart').scrollIntoViewIfNeeded(); await p.waitForTimeout(300); await p.locator('.mc-col').nth(9).hover(); await p.waitForTimeout(200);
  const tip = await p.locator('.dv-tip').innerText();
  await p.locator('.mc-col').nth(9).screenshot({ path: 'test/shots/dash-col.png' }).catch(() => {});
  await p.screenshot({ path: 'test/shots/dash-hover.png' });
  await p.click('#dvTable'); const rows = await p.locator('.dv-table tbody tr').count(); await p.click('#dvTable');
  await shot('dash-dunkel', true);
  const m = await b.newContext({ ...devices['Pixel 7'] }); const q = await m.newPage(); q.on('pageerror', (e) => errs.push(e.stack));
  await setup(q);
  await shot('dash-handy', false, q);
  await q.locator('.mchart').scrollIntoViewIfNeeded(); await q.waitForTimeout(300); await q.evaluate(() => { window.__ev = []; for (const t of ['pointerenter','click','focus','blur','scroll']) addEventListener(t, (e) => __ev.push(t + ':' + (e.pointerType ?? '') + ':' + (e.target.className || e.target.nodeName)), true); }); await q.locator('.mc-col').nth(3).tap(); await q.waitForTimeout(200); const tip2 = await q.locator('.dv-tip').isVisible();
  console.log(JSON.stringify({ tip, rows, tip2, errs }));
  await b.close();
})();
