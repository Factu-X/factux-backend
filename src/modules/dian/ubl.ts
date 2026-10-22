import { create } from "xmlbuilder2";
import type { XMLBuilder } from "xmlbuilder2/lib/interfaces.js";

import { decimalFromScale, parseDecimalToScale } from "../../shared/decimal.js";
import {
  calcularCufe,
  calcularSoftwareSecurityCode,
  type TipoAmbiente,
} from "./cufe.js";

export const NS = {
  invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  sts: "dian:gov:co:facturaelectronica:Structures-2-1",
  ds: "http://www.w3.org/2000/09/xmldsig#",
  xades: "http://uri.etsi.org/01903/v1.3.2#",
} as const;

export const NIT_DIAN = "800197268";
export const AGENCIA_DIAN = { schemeAgencyID: "195", schemeAgencyName: "CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)" };

export const URL_CONSULTA: Record<TipoAmbiente, string> = {
  "1": "https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=",
  "2": "https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=",
};

// Tabla 13.2.1 del anexo: tipos de documento de identificacion.
export const TIPO_DOCUMENTO = { CC: "13", CE: "22", NIT: "31", PASAPORTE: "41" } as const;
export type CodigoTipoDocumento = (typeof TIPO_DOCUMENTO)[keyof typeof TIPO_DOCUMENTO];

export type Ubicacion = {
  municipioCodigo: string;
  ciudad: string;
  departamento: string;
  departamentoCodigo: string;
  direccion: string;
};

export type Parte = {
  tipoPersona: "1" | "2";
  tipoDocumento: CodigoTipoDocumento;
  numeroDocumento: string;
  digitoVerificacion: string | null;
  nombre: string;
  responsabilidades: string;
  responsableIva: boolean;
  ubicacion: Ubicacion | null;
  telefono: string | null;
  email: string | null;
};

export type Linea = {
  codigo: string | null;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  subtotal: string;
  impuesto: string;
  tarifaIva: string;
  tratamientoIva: "GRAVADO" | "EXENTO" | "EXCLUIDO";
};

export type DocumentoFactura = {
  numero: string;
  prefijo: string;
  emitidaEn: Temporal.Instant;
  formaPago: "CONTADO" | "CREDITO";
  fechaVencimiento: string | null;
  emisor: Parte;
  adquirente: Parte;
  lineas: Linea[];
  ambiente: TipoAmbiente;
  resolucion: {
    numero: string;
    vigenciaDesde: string;
    vigenciaHasta: string;
    rangoDesde: number;
    rangoHasta: number;
  };
  software: { id: string; pin: string; nitProveedor: string; dvProveedor: string };
  claveTecnica: string;
};

// --- montos -------------------------------------------------------------------

const cents = (value: string) => parseDecimalToScale(value, 2, "monto");
const money = (value: bigint) => decimalFromScale(value, 2);
const sum = (values: string[]) => values.reduce((acc, value) => acc + cents(value), 0n);

export const llevaIva = (linea: Linea) => linea.tratamientoIva !== "EXCLUIDO";

export type GrupoIva = { tarifa: string; base: string; impuesto: string };

export const agruparIva = (lineas: Linea[]): GrupoIva[] => {
  const grupos = new Map<string, { base: bigint; impuesto: bigint }>();

  for (const linea of lineas.filter(llevaIva)) {
    const tarifa = linea.tratamientoIva === "EXENTO" ? "0.00" : money(cents(linea.tarifaIva));
    const grupo = grupos.get(tarifa) ?? { base: 0n, impuesto: 0n };
    grupo.base += cents(linea.subtotal);
    grupo.impuesto += cents(linea.impuesto);
    grupos.set(tarifa, grupo);
  }

  return [...grupos.entries()].map(([tarifa, grupo]) => ({
    tarifa,
    base: money(grupo.base),
    impuesto: money(grupo.impuesto),
  }));
};

export const calcularTotales = (lineas: Linea[]) => {
  const bruto = sum(lineas.map((l) => l.subtotal));
  const iva = sum(lineas.map((l) => l.impuesto));
  // TaxExclusiveAmount: solo la base de las lineas que llevan IVA (gravadas o exentas).
  const baseGravable = sum(lineas.filter(llevaIva).map((l) => l.subtotal));

  return {
    bruto: money(bruto),
    iva: money(iva),
    baseGravable: money(baseGravable),
    total: money(bruto + iva),
  };
};

// --- fechas -------------------------------------------------------------------

export const fechaHoraColombia = (instant: Temporal.Instant) => {
  const zoned = instant.toZonedDateTimeISO("America/Bogota");
  const hora = zoned.toPlainTime().toString({ smallestUnit: "second" });

  return { fecha: zoned.toPlainDate().toString(), hora: `${hora}-05:00` };
};

// --- XML ----------------------------------------------------------------------

export const cbc = (parent: XMLBuilder, name: string, text: string | number, atts?: Record<string, string>) =>
  parent.ele(NS.cbc, `cbc:${name}`, atts).txt(String(text)).up();

export const cac = (parent: XMLBuilder, name: string) => parent.ele(NS.cac, `cac:${name}`);

export const moneda = { currencyID: "COP" };

const agregarDireccion = (parent: XMLBuilder, name: string, ubicacion: Ubicacion) => {
  const address = cac(parent, name);
  cbc(address, "ID", ubicacion.municipioCodigo);
  cbc(address, "CityName", ubicacion.ciudad);
  cbc(address, "CountrySubentity", ubicacion.departamento);
  cbc(address, "CountrySubentityCode", ubicacion.departamentoCodigo);
  cbc(cac(address, "AddressLine"), "Line", ubicacion.direccion);
  const country = cac(address, "Country");
  cbc(country, "IdentificationCode", "CO");
  cbc(country, "Name", "Colombia", { languageID: "es" });
};

const companyIdAtts = (parte: Parte) => ({
  ...AGENCIA_DIAN,
  ...(parte.tipoDocumento === TIPO_DOCUMENTO.NIT && parte.digitoVerificacion
    ? { schemeID: parte.digitoVerificacion }
    : {}),
  schemeName: parte.tipoDocumento,
});

export const agregarParte = (
  parent: XMLBuilder,
  name: "AccountingSupplierParty" | "AccountingCustomerParty",
  parte: Parte,
  prefijo: string | null,
) => {
  const wrapper = cac(parent, name);
  cbc(wrapper, "AdditionalAccountID", parte.tipoPersona);
  const party = cac(wrapper, "Party");

  if (name === "AccountingCustomerParty") {
    cbc(cac(party, "PartyIdentification"), "ID", parte.numeroDocumento, companyIdAtts(parte));
  }

  cbc(cac(party, "PartyName"), "Name", parte.nombre);

  if (parte.ubicacion) {
    agregarDireccion(cac(party, "PhysicalLocation"), "Address", parte.ubicacion);
  }

  const taxScheme = cac(party, "PartyTaxScheme");
  cbc(taxScheme, "RegistrationName", parte.nombre);
  cbc(taxScheme, "CompanyID", parte.numeroDocumento, companyIdAtts(parte));
  cbc(taxScheme, "TaxLevelCode", parte.responsabilidades, { listName: "48" });
  if (parte.ubicacion) agregarDireccion(taxScheme, "RegistrationAddress", parte.ubicacion);
  const scheme = cac(taxScheme, "TaxScheme");
  cbc(scheme, "ID", parte.responsableIva ? "01" : "ZZ");
  cbc(scheme, "Name", parte.responsableIva ? "IVA" : "No aplica");

  const legal = cac(party, "PartyLegalEntity");
  cbc(legal, "RegistrationName", parte.nombre);
  cbc(legal, "CompanyID", parte.numeroDocumento, companyIdAtts(parte));
  if (prefijo) cbc(cac(legal, "CorporateRegistrationScheme"), "ID", prefijo);

  if (parte.telefono || parte.email) {
    const contact = cac(party, "Contact");
    if (parte.telefono) cbc(contact, "Telephone", parte.telefono);
    if (parte.email) cbc(contact, "ElectronicMail", parte.email);
  }
};

export const agregarSubtotalIva = (parent: XMLBuilder, grupo: GrupoIva) => {
  const subtotal = cac(parent, "TaxSubtotal");
  cbc(subtotal, "TaxableAmount", grupo.base, moneda);
  cbc(subtotal, "TaxAmount", grupo.impuesto, moneda);
  const category = cac(subtotal, "TaxCategory");
  cbc(category, "Percent", grupo.tarifa);
  const scheme = cac(category, "TaxScheme");
  cbc(scheme, "ID", "01");
  cbc(scheme, "Name", "IVA");
};

export const construirFacturaXml = (doc: DocumentoFactura) => {
  const { fecha, hora } = fechaHoraColombia(doc.emitidaEn);
  const totales = calcularTotales(doc.lineas);
  const grupos = agruparIva(doc.lineas);

  const cufe = calcularCufe(
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
    doc.claveTecnica,
  );
  const urlConsulta = `${URL_CONSULTA[doc.ambiente]}${cufe}`;

  const root = create({ version: "1.0", encoding: "UTF-8", standalone: false }).ele(NS.invoice, "Invoice", {
    "xmlns:cac": NS.cac,
    "xmlns:cbc": NS.cbc,
    "xmlns:ext": NS.ext,
    "xmlns:sts": NS.sts,
    "xmlns:ds": NS.ds,
    "xmlns:xades": NS.xades,
  });

  // Extension 1: controles DIAN. Extension 2: queda vacia para la firma.
  const extensions = root.ele(NS.ext, "ext:UBLExtensions");
  const dian = extensions
    .ele(NS.ext, "ext:UBLExtension")
    .ele(NS.ext, "ext:ExtensionContent")
    .ele(NS.sts, "sts:DianExtensions");

  const control = dian.ele(NS.sts, "sts:InvoiceControl");
  control.ele(NS.sts, "sts:InvoiceAuthorization").txt(doc.resolucion.numero);
  const periodo = control.ele(NS.sts, "sts:AuthorizationPeriod");
  cbc(periodo, "StartDate", doc.resolucion.vigenciaDesde);
  cbc(periodo, "EndDate", doc.resolucion.vigenciaHasta);
  const autorizadas = control.ele(NS.sts, "sts:AuthorizedInvoices");
  if (doc.prefijo) autorizadas.ele(NS.sts, "sts:Prefix").txt(doc.prefijo);
  autorizadas.ele(NS.sts, "sts:From").txt(String(doc.resolucion.rangoDesde));
  autorizadas.ele(NS.sts, "sts:To").txt(String(doc.resolucion.rangoHasta));

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
  cbc(root, "CustomizationID", "10");
  cbc(root, "ProfileID", "DIAN 2.1: Factura Electrónica de Venta");
  cbc(root, "ProfileExecutionID", doc.ambiente);
  cbc(root, "ID", doc.numero);
  cbc(root, "UUID", cufe, { schemeID: doc.ambiente, schemeName: "CUFE-SHA384" });
  cbc(root, "IssueDate", fecha);
  cbc(root, "IssueTime", hora);
  if (doc.fechaVencimiento) cbc(root, "DueDate", doc.fechaVencimiento);
  cbc(root, "InvoiceTypeCode", "01");
  cbc(root, "DocumentCurrencyCode", "COP", {
    listAgencyID: "6",
    listAgencyName: "United Nations Economic Commission for Europe",
    listID: "ISO 4217 Alpha",
  });
  cbc(root, "LineCountNumeric", doc.lineas.length);

  agregarParte(root, "AccountingSupplierParty", doc.emisor, doc.prefijo || null);
  agregarParte(root, "AccountingCustomerParty", doc.adquirente, null);

  // Medio de pago: 1 contado / 2 credito; 10 = efectivo, ZZZ = acuerdo mutuo.
  const pago = cac(root, "PaymentMeans");
  cbc(pago, "ID", doc.formaPago === "CONTADO" ? "1" : "2");
  cbc(pago, "PaymentMeansCode", doc.formaPago === "CONTADO" ? "10" : "ZZZ");
  if (doc.fechaVencimiento) cbc(pago, "PaymentDueDate", doc.fechaVencimiento);

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
    const line = cac(root, "InvoiceLine");
    cbc(line, "ID", index + 1);
    cbc(line, "InvoicedQuantity", linea.cantidad, { unitCode: "94" });
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

  return {
    xml: root.end({ headless: false }),
    cufe,
    urlConsulta,
    fecha,
    hora,
    totales,
  };
};
