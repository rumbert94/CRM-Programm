import fs from 'fs';
const { buildCII } = await import('../src/einvoice.js');
const company = { name: 'M GmbH', contactName: 'Max', street: 'Weg 3', zip: '16515', city: 'Oranienburg', phone: '0176', email: 'i@e.de', vatId: 'DE123456789', iban: 'DE02120300000000202051' };
const customer = { name: 'Meier', street: 'H 1', zip: '13467', city: 'Berlin', email: 'm@e.de' };
const ab = { kind: 'rechnung', invoiceType: 'abschlag', abschlagNo: 1, number: '2601', date: '2026-11-18', items: [{ desc: '1. Abschlag 30 %', qty: 1, unit: 'LS', price: 3000, vat: 19 }, { desc: 'Anteil 7', qty: 1, unit: 'LS', price: 60, vat: 7 }] };
const sr = { kind: 'rechnung', invoiceType: 'schluss', number: '2602', date: '2026-11-30', items: [{ desc: 'Bad', qty: 1, unit: 'LS', price: 10000, vat: 19 }, { desc: 'Buch', qty: 1, unit: 'LS', price: 200, vat: 7 }], deductions: [{ number: '2601', date: '2026-11-18', net: 3060, tax: 574.2, gross: 3634.2 }], prepaid: 3634.2 };
fs.writeFileSync('test/out/ab-x.xml', buildCII(ab, company, customer, 'xrechnung'));
fs.writeFileSync('test/out/sr-x.xml', buildCII(sr, company, customer, 'xrechnung'));
