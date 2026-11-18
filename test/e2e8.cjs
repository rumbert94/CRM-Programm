const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => console.log('C:', m.text()));
  p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:4173/'); await p.click('text=Firma anlegen');
  await p.waitForSelector('#profileIn', {state:'attached'}); console.log(await p.evaluate(() => typeof document.querySelector('#profileIn').onchange)); await p.evaluate(() => { window.__t=[]; new MutationObserver((ms)=>ms.forEach(m=>m.addedNodes.forEach(n=>n.className?.includes?.('toast')&&window.__t.push(n.textContent)))).observe(document.body,{childList:true}); }); await p.setInputFiles('#profileIn', '/tmp/claude-0/profil.json');
  await p.waitForTimeout(3000); console.log(await p.evaluate(() => document.querySelector('#profileIn')?.files?.length), await p.evaluate(() => document.body.innerText.slice(0,300))); console.log(await p.evaluate(()=>window.__t), p.url(), await p.locator('.toast').allTextContents().catch(()=>[]));
  const name = await p.inputValue('[name=name]'); const iban = await p.inputValue('[name=iban]').catch(()=>'?');
  const logo = await p.evaluate(() => document.body.innerHTML.match(/Logo: <b>[^<]*/)?.[0]);
  console.log({ name, iban: iban.slice(0,4), logo, errs });
  await b.close();
})();
