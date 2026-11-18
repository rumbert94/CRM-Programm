import fs from 'fs';
globalThis.__crmAssets = {
  regular: fs.readFileSync('public/fonts/LiberationSans-Regular.ttf'),
  bold: fs.readFileSync('public/fonts/LiberationSans-Bold.ttf'),
  icc: fs.readFileSync('public/srgb.icc'),
};
const { buildPdf } = await import('../src/pdf.js');
const { buildCII } = await import('../src/einvoice.js');
const { docFileName } = await import('../src/util.js');
const company = { name: 'Muster Gebäudetechnik', street: 'Werkweg 3', zip: '16515', city: 'Oranienburg', vatId: 'DE123456789', iban: 'DE02120300000000202051', bic: 'BYLADEM1001', contactName: 'Max', phone: '0176 0000000', email: 'info@example.de' };
const customer = { number: '10190', name: 'Firma Fred Muster', street: 'Olafstraße 17', zip: '13467', city: 'Berlin', email: 'a@b.de' };
const doc = { kind: 'rechnung', isStorno: true, number: '2601', sourceNumber: '2609', sourceDate: '2026-11-10', date: '2026-11-18', serviceDate: '2026-11-10',
  subject: 'Storno zu Rechnung 2609 vom 10.11.2026', intro: 'Hiermit wird die Rechnung Nr. 2609 vom 10.11.2026 vollständig storniert.', paymentTerms: '',
  items: [{ desc: 'Rohrreinigung', qty: -1, unit: 'H87', price: 122.2, vat: 19 }, { desc: 'Anfahrt', qty: -1, unit: 'H87', price: 40, vat: 19 }] };
console.log(docFileName(doc));
fs.writeFileSync('test/out/storno.pdf', await buildPdf(doc, company, customer, { zugferd: true }));
fs.writeFileSync('test/out/storno-z.xml', buildCII(doc, company, customer, 'zugferd'));
fs.writeFileSync('test/out/storno-x.xml', buildCII(doc, company, customer, 'xrechnung'));
