import { create } from "xmlbuilder2";

import { calcularCude, calcularSoftwareSecurityCode, type TipoAmbiente } from "./cufe.js";
import {
  AGENCIA_DIAN,
  agregarParte,
  agregarSubtotalIva,
  agruparIva,
  cac,
  calcularTotales,
  cbc,
  fechaHoraColombia,
  llevaIva,
  moneda,
  NIT_DIAN,
  NS,
  URL_CONSULTA,
  type Linea,
  type Parte,
} from "./ubl.js";

export const NS_NOTA_CREDITO = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2";

// Tabla de conceptos de correccion para notas credito del anexo tecnico.
export const CONCEPTO_CORRECCION = {
  PARCIAL: { codigo: "1", descripcion: "Devolución parcial de los bienes y/o no aceptación parcial del servicio" },
  TOTAL: { codigo: "2", descripcion: "Anulación de factura electrónica" },
} as const;

export type DocumentoNotaCredito = {
  numero: string;
  emitidaEn: Temporal.Instant;
  tipoAjuste: keyof typeof CONCEPTO_CORRECCION;
  motivo: string;
  factura: { numero: string; cufe: string; fechaEmision: string };
  emisor: Parte;
  adquirente: Parte;
  lineas: Linea[];
  ambiente: TipoAmbiente;
  software: { id: string; pin: string; nitProveedor: string; dvProveedor: string };
};

export const construirNotaCreditoXml = (doc: DocumentoNotaCredito) => {
  const { fecha, hora } = fechaHoraColombia(doc.emitidaEn);
  const totales = calcularTotales(doc.lineas);
  const grupos = agruparIva(doc.lineas);
  const concepto = CONCEPTO_CORRECCION[doc.tipoAjuste];

  // El CUDE de la nota credito usa el PIN del software en lugar de la clave tecnica.
  const cude = calcularCude(
    {
      numero: doc.numero,
      fecha,
      hora,
      valorBruto: totales.bruto,
      iva: totales.iva,
      inc: "0.00",
      ica: "0.00",
      valorTotal: totales.total,
      nitEmisor: doc.emisor.numeroDocumento,
      documentoAdquirente: doc.adquirente.numeroDocumento,
      ambiente: doc.ambiente,
    },
    doc.software.pin,
  );
  const urlConsulta = `${URL_CONSULTA[doc.ambiente]}${cude}`;

  const root = create({ version: "1.0", encoding: "UTF-8", standalone: false }).ele(NS_NOTA_CREDITO, "CreditNote", {
    "xmlns:cac": NS.cac,
    "xmlns:cbc": NS.cbc,
    "xmlns:ext": NS.ext,
    "xmlns:sts": NS.sts,
    "xmlns:ds": NS.ds,
    "xmlns:xades": NS.xades,
  });

  const extensions = root.ele(NS.ext, "ext:UBLExtensions");
  const dian = extensions
    .ele(NS.ext, "ext:UBLExtension")
    .ele(NS.ext, "ext:ExtensionContent")
    .ele(NS.sts, "sts:DianExtensions");

  cbc(dian.ele(NS.sts, "sts:InvoiceSource"), "IdentificationCode", "CO", {
    listAgencyID: "6",
    listAgencyName: "United Nations Economic Commission for Europe",
    listSchemeURI: "urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1",
  });
  const provider = dian.ele(NS.sts, "sts:SoftwareProvider");
  provider
    .ele(NS.sts, "sts:ProviderID", { ...AGENCIA_DIAN, schemeID: doc.software.dvProveedor, schemeName: "31" })
    .txt(doc.software.nitProveedor);
  provider.ele(NS.sts, "sts:SoftwareID", AGENCIA_DIAN).txt(doc.software.id);
  dian
    .ele(NS.sts, "sts:SoftwareSecurityCode", AGENCIA_DIAN)
    .txt(calcularSoftwareSecurityCode(doc.software.id, doc.software.pin, doc.numero));
  dian
    .ele(NS.sts, "sts:AuthorizationProvider")
    .ele(NS.sts, "sts:AuthorizationProviderID", { ...AGENCIA_DIAN, schemeID: "4", schemeName: "31" })
    .txt(NIT_DIAN);
  dian.ele(NS.sts, "sts:QRCode").txt(urlConsulta);

  extensions.ele(NS.ext, "ext:UBLExtension").ele(NS.ext, "ext:ExtensionContent");

  cbc(root, "UBLVersionID", "UBL 2.1");
  // 20 = nota credito que referencia una factura electronica.
  cbc(root, "CustomizationID", "20");
  cbc(root, "ProfileID", "DIAN 2.1: Nota Crédito de Factura Electrónica de Venta");
  cbc(root, "ProfileExecutionID", doc.ambiente);
  cbc(root, "ID", doc.numero);
  cbc(root, "UUID", cude, { schemeID: doc.ambiente, schemeName: "CUDE-SHA384" });
  cbc(root, "IssueDate", fecha);
  cbc(root, "IssueTime", hora);
  cbc(root, "CreditNoteTypeCode", "91");
  cbc(root, "Note", doc.motivo);
  cbc(root, "DocumentCurrencyCode", "COP");
  cbc(root, "LineCountNumeric", doc.lineas.length);

  const discrepancia = cac(root, "DiscrepancyResponse");
  cbc(discrepancia, "ReferenceID", doc.factura.numero);
  cbc(discrepancia, "ResponseCode", concepto.codigo);
  cbc(discrepancia, "Description", concepto.descripcion);

  const referencia = cac(cac(root, "BillingReference"), "InvoiceDocumentReference");
  cbc(referencia, "ID", doc.factura.numero);
  cbc(referencia, "UUID", doc.factura.cufe, { schemeName: "CUFE-SHA384" });
  cbc(referencia, "IssueDate", doc.factura.fechaEmision);

  agregarParte(root, "AccountingSupplierParty", doc.emisor, null);
  agregarParte(root, "AccountingCustomerParty", doc.adquirente, null);

  if (grupos.length > 0) {
    const taxTotal = cac(root, "TaxTotal");
    cbc(taxTotal, "TaxAmount", totales.iva, moneda);
    for (const grupo of grupos) agregarSubtotalIva(taxTotal, grupo);
  }

  const legal = cac(root, "LegalMonetaryTotal");
  cbc(legal, "LineExtensionAmount", totales.bruto, moneda);
  cbc(legal, "TaxExclusiveAmount", totales.baseGravable, moneda);
  cbc(legal, "TaxInclusiveAmount", totales.total, moneda);
  cbc(legal, "PayableAmount", totales.total, moneda);

  doc.lineas.forEach((linea, index) => {
    const line = cac(root, "CreditNoteLine");
    cbc(line, "ID", index + 1);
    cbc(line, "CreditedQuantity", linea.cantidad, { unitCode: "94" });
    cbc(line, "LineExtensionAmount", linea.subtotal, moneda);

    if (llevaIva(linea)) {
      const lineTax = cac(line, "TaxTotal");
      cbc(lineTax, "TaxAmount", linea.impuesto, moneda);
      agregarSubtotalIva(lineTax, {
        tarifa: linea.tratamientoIva === "EXENTO" ? "0.00" : linea.tarifaIva,
        base: linea.subtotal,
        impuesto: linea.impuesto,
      });
    }

    const item = cac(line, "Item");
    cbc(item, "Description", linea.descripcion);
    if (linea.codigo) cbc(cac(item, "StandardItemIdentification"), "ID", linea.codigo, { schemeID: "999" });

    const price = cac(line, "Price");
    cbc(price, "PriceAmount", linea.precioUnitario, moneda);
    cbc(price, "BaseQuantity", "1.00", { unitCode: "94" });
  });

  return { xml: root.end({ headless: false }), cude, urlConsulta, totales };
};
