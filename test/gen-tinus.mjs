import fs from 'fs';
globalThis.__crmAssets = { regular: fs.readFileSync('public/fonts/LiberationSans-Regular.ttf'), bold: fs.readFileSync('public/fonts/LiberationSans-Bold.ttf'), icc: fs.readFileSync('public/srgb.icc') };
globalThis.__crmLogo = { mime: 'image/png', data: new Blob([fs.readFileSync('/tmp/claude-0/up/logo0.png')]) };
const { buildPdf } = await import('../src/pdf.js');
const company = { ...JSON.parse(fs.readFileSync('/tmp/claude-0/tinus-company.json', 'utf8')), logoFileId: 'x' };
const customer = { number: '10190', name: 'Firma Fred Janke', street: 'Olafstraße 17', zip: '13467', city: 'Berlin' };
const doc = { kind: 'rechnung', number: '2608', date: '2026-05-08', serviceDate: '2026-04-25', subject: 'Friedrichsthaler Weg 10, 13467 Berlin\nFam. Duschanek - Verstopfung',
  paymentTerms: company.texts.paymentTerms, intro: '', outro: '',
  items: [
    { desc: 'Spüle und Waschtisch laufen nicht ab; Siphons sind frei, dahinterliegende Leitung (vermutlich alte DN50) ist verstopft; Beseitigung der Verstopfung von der Küchenseite mit Spirale 1,0 m inkl. anschließender Funktionsprobe', qty: 1, unit: 'H87', price: 122.2, vat: 19 },
    { desc: 'Kfz-Fahrtkostenpauschale < 25 km am 25.04.2026', qty: 1, unit: 'H87', price: 40, vat: 19 } ] };
fs.writeFileSync('test/out/tinus.pdf', await buildPdf(doc, company, customer, { zugferd: true }));
