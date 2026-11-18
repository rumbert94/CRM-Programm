import fs from 'fs';
globalThis.__crmAssets = {
  regular: fs.readFileSync('public/fonts/LiberationSans-Regular.ttf'),
  bold: fs.readFileSync('public/fonts/LiberationSans-Bold.ttf'),
  icc: fs.readFileSync('public/srgb.icc'),
};
const { buildPdf } = await import('../src/pdf.js');
const { buildCII } = await import('../src/einvoice.js');
const company = { name: 'Muster Haustechnik GmbH', owner: 'Max Muster', contactName: 'Max Muster', street: 'Werkstraße 5', zip: '12345', city: 'Musterstadt', country: 'DE', phone: '+49 123 45678', email: 'info@muster-haustechnik.de', web: 'www.muster-haustechnik.de', vatId: 'DE123456789', taxNumber: '12/345/67890', iban: 'DE02120300000000202051', bic: 'BYLADEM1001', bankName: 'Deutsche Kreditbank', register: 'Amtsgericht Musterstadt HRB 1234' };
const customer = { number: 'K-1001', name: 'Erika Mustermann', street: 'Hauptstraße 1', zip: '54321', city: 'Beispielhausen', country: 'DE', email: 'erika@example.com' };
const items = [];
for (let i = 0; i < 18; i++) items.push({ title: i % 3 ? 'Kupferrohr 15 mm verlegen' : 'Arbeitszeit Monteur', desc: 'inkl. Befestigungsmaterial, Fittings und Abdichtung gemäß DIN. Altes Material wird fachgerecht entsorgt.', qty: i % 3 ? '12,5' : 3, unit: i % 3 ? 'MTR' : 'HUR', price: i % 3 ? '18,40' : '65', vat: i === 5 ? 7 : 19 });
const doc = { kind: 'rechnung', number: 'RE-2026-0001', date: '2026-11-18', serviceDate: '2026-11-10', dueDate: '2026-12-02', subject: 'Badsanierung Hauptstraße 1', intro: 'Sehr geehrte Frau Mustermann,\nwir bedanken uns für Ihren Auftrag und berechnen Ihnen folgende Leistungen:', outro: 'Mit freundlichen Grüßen\nMax Muster', paymentTerms: 'Zahlbar bis 02.12.2026 ohne Abzug.', items };
fs.mkdirSync('test/out', { recursive: true });
fs.writeFileSync('test/out/zugferd.pdf', await buildPdf(doc, company, customer, { zugferd: true }));
fs.writeFileSync('test/out/xrechnung.xml', buildCII(doc, company, customer, 'xrechnung'));
const ku = { ...company, smallBusiness: true };
fs.writeFileSync('test/out/klein.xml', buildCII({ ...doc, items: items.slice(0, 2) }, ku, customer, 'xrechnung'));
fs.writeFileSync('test/out/reverse.xml', buildCII({ ...doc, taxMode: 'reverse', items: items.slice(0, 2) }, company, { ...customer, vatId: 'DE987654321' }, 'xrechnung'));
console.log('ok');
