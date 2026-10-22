import type { XMLBuilder } from "xmlbuilder2/lib/interfaces.js";

import { decimalFromScale, parseDecimalToScale } from "../../shared/decimal.js";
import type { TipoAmbiente } from "./cufe.js";

export const NS = {
  invoice: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  sts: "dian:gov:co:facturaelectronica:Structures-2-1",
  ds: "http://www.w3.org/2000/09/xmldsig#",
  // Identificador del namespace XAdES (ETSI), no una URL que se consulte: debe ser http para que la firma valide.
  xades: "http://uri.etsi.org/01903/v1.3.2#", // NOSONAR
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

// Helpers compartidos por la nota credito (HU-08) y el PDF. La factura la genera facturas.xml.ts (HU-06).

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
