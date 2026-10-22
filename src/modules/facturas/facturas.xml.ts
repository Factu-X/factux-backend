import { createHash } from "node:crypto";

import { decimalFromScale, parseDecimalToScale } from "../../shared/decimal.js";
import { calcularCufe as cufeAnexo } from "../dian/cufe.js";

// HU-06: documento UBL 2.1 segun el Anexo Tecnico de Factura Electronica de Venta (DIAN).
// Se genera listo para firmar: el segundo UBLExtension queda vacio para la firma XAdES (HU-07).

const DIAN_AGENCY = 'schemeAgencyID="195" schemeAgencyName="CO, DIAN (Dirección de Impuestos y Aduanas Nacionales)"';
const NIT_DIAN = "800197268";
const DV_DIAN = "4";

// Lista 13.2.1 del Anexo: tipos de documento de identificacion.
const TIPO_DOCUMENTO: Record<TipoIdentificacion, string> = {
  CC: "13",
  CE: "22",
  NIT: "31",
  PASAPORTE: "41",
};

type TipoIdentificacion = "CC" | "CE" | "NIT" | "PASAPORTE";

export type LineaFactura = {
  codigo: string;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  subtotal: string;
  impuesto: string;
  tarifaIva: string;
  tratamientoIva: "GRAVADO" | "EXENTO" | "EXCLUIDO";
};

export type FacturaXmlInput = {
  numero: string;
  prefijo: string | null;
  fechaEmision: string;
  horaEmision: string;
  fechaVencimiento: string | null;
  formaPago: "CONTADO" | "CREDITO";
  ambiente: "HABILITACION" | "PRODUCCION";
  resolucion: {
    numero: string;
    vigenciaDesde: string;
    vigenciaHasta: string;
    rangoDesde: number;
    rangoHasta: number;
  };
  software: { id: string; pin: string };
  claveTecnica: string;
  emisor: {
    nit: string;
    dv: string;
    razonSocial: string;
    nombreComercial: string | null;
    tipoPersona: string;
    responsabilidadesFiscales: string;
    direccion: string;
    ciudad: string;
    departamento: string;
    codigoMunicipio: string;
    telefono: string;
    email: string;
  };
  adquiriente: {
    tipoIdentificacion: TipoIdentificacion;
    numeroIdentificacion: string;
    dv: string | null;
    nombre: string;
    direccion: string | null;
    telefono: string | null;
    email: string | null;
  };
  lineas: LineaFactura[];
};

const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const cents = (value: string) => parseDecimalToScale(value, 2, "valor");
const money = (value: bigint) => decimalFromScale(value, 2);
const sum = (values: bigint[]) => values.reduce((acc, value) => acc + value, 0n);
const sha384 = (value: string) => createHash("sha384").update(value, "utf8").digest("hex");

const ambienteCodigo = (ambiente: FacturaXmlInput["ambiente"]) =>
  ambiente === "PRODUCCION" ? "1" : "2";

const llevaIva = (linea: LineaFactura) => linea.tratamientoIva !== "EXCLUIDO";

export const calcularTotales = (lineas: LineaFactura[]) => {
  const conIva = lineas.filter(llevaIva);
  const valorBruto = sum(lineas.map((l) => cents(l.subtotal)));
  const baseGravable = sum(conIva.map((l) => cents(l.subtotal)));
  const iva = sum(conIva.map((l) => cents(l.impuesto)));

  // Un TaxSubtotal por tarifa; los exentos van con tarifa 0 y los excluidos no se reportan.
  const porTarifa = new Map<string, { base: bigint; impuesto: bigint }>();
  for (const linea of conIva) {
    const tarifa = money(cents(linea.tarifaIva));
    const acc = porTarifa.get(tarifa) ?? { base: 0n, impuesto: 0n };
    acc.base += cents(linea.subtotal);
    acc.impuesto += cents(linea.impuesto);
    porTarifa.set(tarifa, acc);
  }

  return { valorBruto, baseGravable, iva, total: valorBruto + iva, porTarifa };
};

// CUFE = SHA-384(NumFac + FecFac + HorFac + ValFac + 01 + ValIva + 04 + ValINC + 03 + ValICA
//                + ValTot + NitOFE + NumAdq + ClTec + TipoAmbiente). Misma formula que valida el simulador.
export const calcularCufe = (input: FacturaXmlInput) => {
  const totales = calcularTotales(input.lineas);

  return cufeAnexo(
    {
      numero: input.numero,
      fecha: input.fechaEmision,
      hora: input.horaEmision,
      valorBruto: money(totales.valorBruto),
      iva: money(totales.iva),
      inc: "0.00",
      ica: "0.00",
      valorTotal: money(totales.total),
      nitEmisor: input.emisor.nit,
      documentoAdquirente: input.adquiriente.numeroIdentificacion,
      ambiente: ambienteCodigo(input.ambiente),
    },
    input.claveTecnica,
  );
};

export const calcularSoftwareSecurityCode = (input: FacturaXmlInput) =>
  sha384(`${input.software.id}${input.software.pin}${input.numero}`);

const taxSubtotal = (base: bigint, impuesto: bigint, tarifa: string) => `
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="COP">${money(base)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="COP">${money(impuesto)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>${tarifa}</cbc:Percent>
          <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`;

const direccionEmisor = (e: FacturaXmlInput["emisor"]) => `
          <cbc:ID>${e.codigoMunicipio}</cbc:ID>
          <cbc:CityName>${escape(e.ciudad)}</cbc:CityName>
          <cbc:CountrySubentity>${escape(e.departamento)}</cbc:CountrySubentity>
          <cbc:CountrySubentityCode>${e.codigoMunicipio.slice(0, 2)}</cbc:CountrySubentityCode>
          <cac:AddressLine><cbc:Line>${escape(e.direccion)}</cbc:Line></cac:AddressLine>
          <cac:Country><cbc:IdentificationCode>CO</cbc:IdentificationCode><cbc:Name languageID="es">Colombia</cbc:Name></cac:Country>`;

export const buildFacturaXml = (input: FacturaXmlInput) => {
  const cufe = calcularCufe(input);
  const totales = calcularTotales(input.lineas);
  const { emisor, adquiriente, resolucion } = input;
  const ambiente = ambienteCodigo(input.ambiente);
  const qrBase =
    input.ambiente === "PRODUCCION"
      ? "https://catalogo-vpfe.dian.gov.co"
      : "https://catalogo-vpfe-hab.dian.gov.co";
  const qr = [
    `NumFac: ${input.numero}`,
    `FecFac: ${input.fechaEmision}`,
    `HorFac: ${input.horaEmision}`,
    `NitFac: ${emisor.nit}`,
    `DocAdq: ${adquiriente.numeroIdentificacion}`,
    `ValFac: ${money(totales.valorBruto)}`,
    `ValIva: ${money(totales.iva)}`,
    `ValOtroIm: 0.00`,
    `ValTolFac: ${money(totales.total)}`,
    `CUFE: ${cufe}`,
    `QRCode: ${qrBase}/document/searchqr?documentkey=${cufe}`,
  ].join("\n");

  const esNit = adquiriente.tipoIdentificacion === "NIT";
  const docAdquiriente = `schemeName="${TIPO_DOCUMENTO[adquiriente.tipoIdentificacion]}"${
    esNit && adquiriente.dv ? ` schemeID="${adquiriente.dv}"` : ""
  }`;
  const nitEmisor = `${DIAN_AGENCY} schemeID="${emisor.dv}" schemeName="31"`;

  const taxTotal =
    totales.porTarifa.size === 0
      ? ""
      : `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="COP">${money(totales.iva)}</cbc:TaxAmount>${[...totales.porTarifa]
      .map(([tarifa, t]) => taxSubtotal(t.base, t.impuesto, tarifa))
      .join("")}
  </cac:TaxTotal>`;

  const lineas = input.lineas
    .map((linea, index) => {
      const lineaIva = llevaIva(linea)
        ? `
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="COP">${money(cents(linea.impuesto))}</cbc:TaxAmount>${taxSubtotal(
        cents(linea.subtotal),
        cents(linea.impuesto),
        money(cents(linea.tarifaIva)),
      )}
    </cac:TaxTotal>`
        : "";

      return `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="94">${linea.cantidad}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="COP">${money(cents(linea.subtotal))}</cbc:LineExtensionAmount>${lineaIva}
    <cac:Item>
      <cbc:Description>${escape(linea.descripcion)}</cbc:Description>
      <cac:StandardItemIdentification><cbc:ID schemeID="999">${escape(linea.codigo)}</cbc:ID></cac:StandardItemIdentification>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="COP">${money(cents(linea.precioUnitario))}</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="94">1.00</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:sts="dian:gov:co:facturaelectronica:Structures-2-1"
  xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"
  xmlns:xades141="http://uri.etsi.org/01903/v1.4.1#"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 http://docs.oasis-open.org/ubl/os-UBL-2.1/xsd/maindoc/UBL-Invoice-2.1.xsd">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent>
        <sts:DianExtensions>
          <sts:InvoiceControl>
            <sts:InvoiceAuthorization>${escape(resolucion.numero)}</sts:InvoiceAuthorization>
            <sts:AuthorizationPeriod>
              <cbc:StartDate>${resolucion.vigenciaDesde}</cbc:StartDate>
              <cbc:EndDate>${resolucion.vigenciaHasta}</cbc:EndDate>
            </sts:AuthorizationPeriod>
            <sts:AuthorizedInvoices>${input.prefijo ? `
              <sts:Prefix>${escape(input.prefijo)}</sts:Prefix>` : ""}
              <sts:From>${resolucion.rangoDesde}</sts:From>
              <sts:To>${resolucion.rangoHasta}</sts:To>
            </sts:AuthorizedInvoices>
          </sts:InvoiceControl>
          <sts:InvoiceSource>
            <cbc:IdentificationCode listAgencyID="6" listAgencyName="United Nations Economic Commission for Europe" listSchemeURI="urn:oasis:names:specification:ubl:codelist:gc:CountryIdentificationCode-2.1">CO</cbc:IdentificationCode>
          </sts:InvoiceSource>
          <sts:SoftwareProvider>
            <sts:ProviderID ${nitEmisor}>${emisor.nit}</sts:ProviderID>
            <sts:SoftwareID ${DIAN_AGENCY}>${escape(input.software.id)}</sts:SoftwareID>
          </sts:SoftwareProvider>
          <sts:SoftwareSecurityCode ${DIAN_AGENCY}>${calcularSoftwareSecurityCode(input)}</sts:SoftwareSecurityCode>
          <sts:AuthorizationProvider>
            <sts:AuthorizationProviderID ${DIAN_AGENCY} schemeID="${DV_DIAN}" schemeName="31">${NIT_DIAN}</sts:AuthorizationProviderID>
          </sts:AuthorizationProvider>
          <sts:QRCode>${escape(qr)}</sts:QRCode>
        </sts:DianExtensions>
      </ext:ExtensionContent>
    </ext:UBLExtension>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>UBL 2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>10</cbc:CustomizationID>
  <cbc:ProfileID>DIAN 2.1: Factura Electrónica de Venta</cbc:ProfileID>
  <cbc:ProfileExecutionID>${ambiente}</cbc:ProfileExecutionID>
  <cbc:ID>${escape(input.numero)}</cbc:ID>
  <cbc:UUID schemeID="${ambiente}" schemeName="CUFE-SHA384">${cufe}</cbc:UUID>
  <cbc:IssueDate>${input.fechaEmision}</cbc:IssueDate>
  <cbc:IssueTime>${input.horaEmision}</cbc:IssueTime>${input.fechaVencimiento ? `
  <cbc:DueDate>${input.fechaVencimiento}</cbc:DueDate>` : ""}
  <cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>COP</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${input.lineas.length}</cbc:LineCountNumeric>
  <cac:AccountingSupplierParty>
    <cbc:AdditionalAccountID>${emisor.tipoPersona === "NATURAL" ? "2" : "1"}</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyName><cbc:Name>${escape(emisor.nombreComercial ?? emisor.razonSocial)}</cbc:Name></cac:PartyName>
      <cac:PhysicalLocation>
        <cac:Address>${direccionEmisor(emisor)}
        </cac:Address>
      </cac:PhysicalLocation>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>${escape(emisor.razonSocial)}</cbc:RegistrationName>
        <cbc:CompanyID ${nitEmisor}>${emisor.nit}</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">${escape(emisor.responsabilidadesFiscales)}</cbc:TaxLevelCode>
        <cac:RegistrationAddress>${direccionEmisor(emisor)}
        </cac:RegistrationAddress>
        <cac:TaxScheme><cbc:ID>01</cbc:ID><cbc:Name>IVA</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escape(emisor.razonSocial)}</cbc:RegistrationName>
        <cbc:CompanyID ${nitEmisor}>${emisor.nit}</cbc:CompanyID>${input.prefijo ? `
        <cac:CorporateRegistrationScheme><cbc:ID>${escape(input.prefijo)}</cbc:ID></cac:CorporateRegistrationScheme>` : ""}
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Telephone>${escape(emisor.telefono)}</cbc:Telephone>
        <cbc:ElectronicMail>${escape(emisor.email)}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cbc:AdditionalAccountID>${esNit ? "1" : "2"}</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID ${docAdquiriente}>${escape(adquiriente.numeroIdentificacion)}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${escape(adquiriente.nombre)}</cbc:Name></cac:PartyName>${adquiriente.direccion ? `
      <cac:PhysicalLocation><cac:Address><cac:AddressLine><cbc:Line>${escape(adquiriente.direccion)}</cbc:Line></cac:AddressLine><cac:Country><cbc:IdentificationCode>CO</cbc:IdentificationCode></cac:Country></cac:Address></cac:PhysicalLocation>` : ""}
      <cac:PartyTaxScheme>
        <cbc:RegistrationName>${escape(adquiriente.nombre)}</cbc:RegistrationName>
        <cbc:CompanyID ${DIAN_AGENCY} ${docAdquiriente}>${escape(adquiriente.numeroIdentificacion)}</cbc:CompanyID>
        <cbc:TaxLevelCode listName="48">R-99-PN</cbc:TaxLevelCode>
        <cac:TaxScheme><cbc:ID>ZZ</cbc:ID><cbc:Name>No aplica</cbc:Name></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escape(adquiriente.nombre)}</cbc:RegistrationName>
        <cbc:CompanyID ${DIAN_AGENCY} ${docAdquiriente}>${escape(adquiriente.numeroIdentificacion)}</cbc:CompanyID>
      </cac:PartyLegalEntity>${adquiriente.telefono || adquiriente.email ? `
      <cac:Contact>${adquiriente.telefono ? `
        <cbc:Telephone>${escape(adquiriente.telefono)}</cbc:Telephone>` : ""}${adquiriente.email ? `
        <cbc:ElectronicMail>${escape(adquiriente.email)}</cbc:ElectronicMail>` : ""}
      </cac:Contact>` : ""}
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:ID>${input.formaPago === "CONTADO" ? "1" : "2"}</cbc:ID>
    <cbc:PaymentMeansCode>ZZZ</cbc:PaymentMeansCode>${input.fechaVencimiento ? `
    <cbc:PaymentDueDate>${input.fechaVencimiento}</cbc:PaymentDueDate>` : ""}
  </cac:PaymentMeans>${taxTotal}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="COP">${money(totales.valorBruto)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="COP">${money(totales.baseGravable)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="COP">${money(totales.total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="COP">${money(totales.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineas}
</Invoice>
`;

  return { cufe, xml, totales };
};
