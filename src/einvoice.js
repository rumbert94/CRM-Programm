// E-Rechnung im UN/CEFACT-CII-Format (EN 16931).
// Dieselbe XML wird als XRechnung 3.0 (reine XML) oder als ZUGFeRD/Factur-X
// Profil EN 16931 (in PDF/A-3 eingebettet) verwendet.
import { calcTotals, parseNum } from './util.js';

const x = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const amt = (n) => (Math.round(n * 100) / 100).toFixed(2);
const qtyStr = (n) => String(Math.round(n * 10000) / 10000);
const d102 = (iso) => `<udt:DateTimeString format="102">${(iso || '').replace(/-/g, '').slice(0, 8)}</udt:DateTimeString>`;
const tag = (name, val) => (val === undefined || val === null || val === '' ? '' : `<ram:${name}>${x(val)}</ram:${name}>`);

export const GUIDELINES = {
  xrechnung: 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
  zugferd: 'urn:cen.eu:en16931:2017',
};

function taxCategory(company, doc, rate) {
  if (company.smallBusiness)
    return { code: 'E', reason: 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG' };
  if (doc.taxMode === 'reverse')
    return { code: 'AE', reason: 'Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG' };
  if (rate === 0) return { code: 'Z' };
  return { code: 'S' };
}

// Prüft Pflichtangaben und liefert eine Liste verständlicher Hinweise
export function checkEInvoice(doc, company, customer, profile) {
  const m = [];
  const need = (v, msg) => !String(v ?? '').trim() && m.push(msg);
  need(company.name, 'Firma: Name fehlt');
  need(company.street, 'Firma: Straße fehlt');
  need(company.zip, 'Firma: PLZ fehlt');
  need(company.city, 'Firma: Ort fehlt');
  if (!company.vatId && !company.taxNumber) m.push('Firma: USt-IdNr. oder Steuernummer fehlt');
  need(customer?.name, 'Kunde: Name fehlt');
  need(customer?.zip, 'Kunde: PLZ fehlt');
  need(customer?.city, 'Kunde: Ort fehlt');
  need(doc.number, 'Rechnungsnummer fehlt');
  need(doc.date, 'Rechnungsdatum fehlt');
  if (!(doc.items || []).length) m.push('Keine Positionen');
  if (doc.taxMode === 'reverse') {
    need(customer?.vatId, '§13b: USt-IdNr. des Kunden fehlt');
    need(company.vatId, '§13b: eigene USt-IdNr. fehlt');
  }
  if (profile === 'xrechnung') {
    need(company.contactName || company.owner, 'XRechnung: Ansprechpartner der Firma fehlt');
    need(company.phone, 'XRechnung: Telefon der Firma fehlt');
    need(company.email, 'XRechnung: E-Mail der Firma fehlt');
    need(customer?.email, 'XRechnung: E-Mail-Adresse des Kunden fehlt (elektronische Adresse)');
  }
  return m;
}

function party(p, { seller, profile }) {
  const contactName = seller ? p.contactName || p.owner : p.contact;
  const contact =
    seller && (contactName || p.phone || p.email)
      ? `<ram:DefinedTradeContact>${tag('PersonName', contactName)}${
          p.phone ? `<ram:TelephoneUniversalCommunication>${tag('CompleteNumber', p.phone)}</ram:TelephoneUniversalCommunication>` : ''
        }${p.email ? `<ram:EmailURIUniversalCommunication>${tag('URIID', p.email)}</ram:EmailURIUniversalCommunication>` : ''}</ram:DefinedTradeContact>`
      : '';
  const addr = `<ram:PostalTradeAddress>${tag('PostcodeCode', p.zip)}${tag('LineOne', p.street)}${tag('LineTwo', p.street2)}${tag(
    'CityName',
    p.city
  )}${tag('CountryID', (p.country || 'DE').toUpperCase())}</ram:PostalTradeAddress>`;
  const uri = p.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(p.email)}</ram:URIID></ram:URIUniversalCommunication>` : '';
  let taxReg = '';
  if (p.vatId) taxReg += `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(p.vatId.replace(/\s/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration>`;
  if (seller && p.taxNumber) taxReg += `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${x(p.taxNumber)}</ram:ID></ram:SpecifiedTaxRegistration>`;
  const name = seller ? p.name : p.name;
  return `${seller ? '' : tag('ID', p.number)}${tag('Name', name)}${contact}${addr}${uri}${taxReg}`;
}

export function buildCII(doc, company, customer, profile = 'zugferd') {
  const t = calcTotals(doc, company);
  const cur = 'EUR';
  const notes = [];
  if (doc.subject) notes.push(doc.subject);
  if (company.smallBusiness) notes.push('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.');
  if (doc.taxMode === 'reverse') notes.push('Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG).');
  // Pflichtangabe BT-22 für Sitz/Registrierung (optional, hilft bei Prüfern)
  const regNote = [company.name, company.street, `${company.zip} ${company.city}`, company.register].filter(Boolean).join(', ');
  notes.push(regNote);

  const lines = t.lines
    .map((l, i) => {
      const cat = taxCategory(company, doc, l.vat);
      return `<ram:IncludedSupplyChainTradeLineItem>
<ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
<ram:SpecifiedTradeProduct>${tag('Name', l.title || l.desc?.split('\n')[0] || 'Position ' + (i + 1))}${tag('Description', l.title ? l.desc : '')}</ram:SpecifiedTradeProduct>
<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${amt(l.price)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${x(l.unit || 'H87')}">${qtyStr(l.qty)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
<ram:SpecifiedLineTradeSettlement>
<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat.code}</ram:CategoryCode><ram:RateApplicablePercent>${l.vat}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(l.net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
</ram:SpecifiedLineTradeSettlement>
</ram:IncludedSupplyChainTradeLineItem>`;
    })
    .join('\n');

  const taxes = t.groups
    .map((g) => {
      const cat = taxCategory(company, doc, g.rate);
      return `<ram:ApplicableTradeTax><ram:CalculatedAmount>${amt(g.tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>${tag(
        'ExemptionReason',
        cat.reason
      )}<ram:BasisAmount>${amt(g.base)}</ram:BasisAmount><ram:CategoryCode>${cat.code}</ram:CategoryCode><ram:RateApplicablePercent>${g.rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`;
    })
    .join('\n');

  const iban = (company.iban || '').replace(/\s/g, '');
  const payment = iban
    ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${x(iban)}</ram:IBANID>${tag(
        'AccountName',
        company.accountHolder || company.name
      )}</ram:PayeePartyCreditorFinancialAccount>${
        company.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${x(company.bic.replace(/\s/g, ''))}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''
      }</ram:SpecifiedTradeSettlementPaymentMeans>`
    : `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>1</ram:TypeCode></ram:SpecifiedTradeSettlementPaymentMeans>`;

  const terms = `<ram:SpecifiedTradePaymentTerms>${tag('Description', doc.paymentTerms || '')}${
    doc.dueDate ? `<ram:DueDateDateTime>${d102(doc.dueDate)}</ram:DueDateDateTime>` : ''
  }</ram:SpecifiedTradePaymentTerms>`;

  const buyerRef = customer?.leitwegId || doc.buyerReference || customer?.number || '-';
  const businessProcess =
    profile === 'xrechnung'
      ? '<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>'
      : '';
  const orderRef = doc.orderReference
    ? `<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${x(doc.orderReference)}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext>${businessProcess}<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${GUIDELINES[profile]}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>
<ram:ID>${x(doc.number)}</ram:ID>
<ram:TypeCode>${doc.isCreditNote ? '381' : '380'}</ram:TypeCode>
<ram:IssueDateTime>${d102(doc.date)}</ram:IssueDateTime>
${notes.map((n) => `<ram:IncludedNote><ram:Content>${x(n)}</ram:Content></ram:IncludedNote>`).join('')}
</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${lines}
<ram:ApplicableHeaderTradeAgreement>
<ram:BuyerReference>${x(buyerRef)}</ram:BuyerReference>
<ram:SellerTradeParty>${party(company, { seller: true, profile })}</ram:SellerTradeParty>
<ram:BuyerTradeParty>${party(customer || {}, { seller: false, profile })}</ram:BuyerTradeParty>
${orderRef}
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery>${
    doc.serviceDate || doc.date
      ? `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime>${d102(doc.serviceDate || doc.date)}</ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>`
      : ''
  }</ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>
<ram:PaymentReference>${x(doc.number)}</ram:PaymentReference>
<ram:InvoiceCurrencyCode>${cur}</ram:InvoiceCurrencyCode>
${payment}
${taxes}
${terms}
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
<ram:LineTotalAmount>${amt(t.net)}</ram:LineTotalAmount>
<ram:TaxBasisTotalAmount>${amt(t.net)}</ram:TaxBasisTotalAmount>
<ram:TaxTotalAmount currencyID="${cur}">${amt(t.tax)}</ram:TaxTotalAmount>
<ram:GrandTotalAmount>${amt(t.gross)}</ram:GrandTotalAmount>
<ram:DuePayableAmount>${amt(t.gross - parseNum(doc.prepaid || 0))}</ram:DuePayableAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}
