import fs from 'fs';
globalThis.__crmAssets = {
  regular: fs.readFileSync('public/fonts/LiberationSans-Regular.ttf'),
  bold: fs.readFileSync('public/fonts/LiberationSans-Bold.ttf'),
  icc: fs.readFileSync('public/srgb.icc'),
};
const logoPath = 'test/out/logo.png';
if (fs.existsSync(logoPath)) globalThis.__crmLogo = { mime: 'image/png', data: new Blob([fs.readFileSync(logoPath)]) };
const { buildPdf } = await import('../src/pdf.js');
const { buildCII } = await import('../src/einvoice.js');
const company = { name: 'Muster Gebäudetechnik', footerExtra: 'Meisterbetrieb', owner: 'Max Muster', street: 'Werkweg 3', zip: '16515', city: 'Oranienburg', phone: '0176 0000000', email: 'info@example.de', web: 'www.example.de', vatId: 'DE123456789', iban: 'DE02120300000000202051', bic: 'BYLADEM1001', bankName: 'Deutsche Kreditbank DKB', logoFileId: fs.existsSync(logoPath) ? 'x' : null };
const customer = { number: '10190', name: 'Firma Fred Muster', street: 'Olafstraße 17', zip: '13467', city: 'Berlin', email: 'a@b.de' };
const doc = { kind: 'rechnung', number: '2609', date: '2026-11-18', serviceDate: '2026-04-25', subject: 'Friedrichsthaler Weg 10, 13467 Berlin\nFam. Muster - Verstopfung',
  paymentTerms: 'Zahlbar sofort ohne Abzüge an die unten genannte Bankverbindung unter Angabe der Rechnungsnummer.',
  outro: 'Bis zur vollständigen Bezahlung bleibt die Ware mein Eigentum. Es gelten meine Allgemeinen Geschäftsbedingungen.',
  items: [
    { desc: 'Spüle und Waschtisch laufen nicht ab; Siphons sind frei, dahinterliegende Leitung (vermutlich alte DN50) ist verstopft; Beseitigung der Verstopfung von der Küchenseite mit Spirale 1,0 m inkl. anschließender Funktionsprobe', qty: 1, unit: 'H87', price: 122.2, vat: 19 },
    { desc: 'Kfz-Fahrtkostenpauschale < 25 km am 25.04.2026', qty: 1, unit: 'H87', price: 40, vat: 19 },
  ] };
fs.writeFileSync('test/out/lex1.pdf', await buildPdf(doc, company, customer, { zugferd: true }));
const doc2 = { ...doc, number: '2610', serviceMode: 'period', serviceFrom: '2026-11-01', serviceTo: '2026-11-14', subject: 'Badsanierung', items: [
  { type: 'title', title: 'Abbrucharbeiten' },
  { title: 'Fliesen abschlagen', desc: 'Wand- und Bodenfliesen inkl. Kleber entfernen', qty: '18,5', unit: 'MTK', price: 24, vat: 19 },
  { title: 'Entsorgung', qty: 1, unit: 'LS', price: 180, vat: 19 },
  { type: 'title', title: 'Sanitärinstallation' },
  { title: 'Vorwandelement WC', desc: 'Geberit Duofix, inkl. Montage', qty: 1, unit: 'H87', price: 420, vat: 19 },
  { title: 'Arbeitszeit Monteur', qty: 6, unit: 'HUR', price: 62, vat: 19 },
] };
fs.writeFileSync('test/out/lex2.pdf', await buildPdf(doc2, company, customer, { zugferd: true }));
fs.writeFileSync('test/out/lex2-x.xml', buildCII(doc2, { ...company, contactName: 'Max' }, customer, 'xrechnung'));
console.log('ok');
