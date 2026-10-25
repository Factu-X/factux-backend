import { DOMParser } from "@xmldom/xmldom";

import { calcularCude, calcularCufe, type CufeInput, type TipoAmbiente } from "./cufe.js";
import { verificarFirma } from "./signer.js";
import { NS } from "./ubl.js";

export type ResultadoDian = {
  estado: "VALIDADO" | "RECHAZADO";
  codigo: string;
  mensaje: string;
  errores: { regla: string; mensaje: string }[];
  recibidoEn: string;
};

// Punto unico de salida hacia la DIAN. Hoy lo implementa el simulador; cuando haya NIT
// habilitado y certificado real se agrega la implementacion SOAP sin tocar el resto.
export interface DianGateway {
  enviarFactura(xmlFirmado: string): Promise<ResultadoDian>;
  enviarNotaCredito(xmlFirmado: string): Promise<ResultadoDian>;
}

type Regla = { regla: string; mensaje: string };

const texto = (doc: Document, ns: string, nombre: string, indice = 0) =>
  doc.getElementsByTagNameNS(ns, nombre)[indice]?.textContent?.trim() ?? "";

const centavos = (valor: string) => Math.round(Number(valor) * 100);

const companyId = (doc: Document, parte: string) =>
  doc.getElementsByTagNameNS(NS.cac, parte)[0]?.getElementsByTagNameNS(NS.cbc, "CompanyID")[0]?.textContent ?? "";

// Datos con los que se recalcula el CUFE/CUDE a partir del propio XML.
const datosCodigo = (doc: Document): CufeInput => ({
  numero: texto(doc, NS.cbc, "ID"),
  fecha: texto(doc, NS.cbc, "IssueDate"),
  hora: texto(doc, NS.cbc, "IssueTime"),
  valorBruto: texto(doc, NS.cbc, "LineExtensionAmount"),
  iva: texto(doc, NS.cbc, "TaxAmount") || "0.00",
  inc: "0.00",
  ica: "0.00",
  valorTotal: texto(doc, NS.cbc, "PayableAmount"),
  nitEmisor: companyId(doc, "AccountingSupplierParty"),
  documentoAdquirente: companyId(doc, "AccountingCustomerParty"),
  ambiente: texto(doc, NS.cbc, "ProfileExecutionID") as TipoAmbiente,
});

const resultado = (errores: Regla[], aprobado: string): ResultadoDian => {
  const recibidoEn = new Date().toISOString();

  return errores.length > 0
    ? { estado: "RECHAZADO", codigo: "99", mensaje: "Documento con errores en campos mandatorios", errores, recibidoEn }
    : { estado: "VALIDADO", codigo: "00", mensaje: aprobado, errores: [], recibidoEn };
};

// Valida el subconjunto de reglas del anexo tecnico que FactuX puede comprobar sin la DIAN.
// Los codigos SIM-* son propios del simulador; "00" y "99" imitan el StatusCode del servicio real.
export class SimuladorDianGateway implements DianGateway {
  constructor(
    private readonly claveTecnica: string,
    private readonly pinSoftware: string,
  ) {}

  private async reglasComunes(xmlFirmado: string, doc: Document, nombreLinea: string) {
    const errores: Regla[] = [];

    if (!(await verificarFirma(xmlFirmado))) {
      errores.push({ regla: "SIM-FIRMA", mensaje: "La firma digital no es valida o el documento fue modificado" });
    }

    const datos = datosCodigo(doc);

    if (centavos(datos.valorBruto) + centavos(datos.iva) !== centavos(datos.valorTotal)) {
      errores.push({ regla: "SIM-TOTAL", mensaje: "El valor a pagar no es la suma del bruto y los impuestos" });
    }

    const lineas = doc.getElementsByTagNameNS(NS.cac, nombreLinea).length;

    if (lineas === 0 || String(lineas) !== texto(doc, NS.cbc, "LineCountNumeric")) {
      errores.push({ regla: "SIM-LINEAS", mensaje: "LineCountNumeric no coincide con las lineas del documento" });
    }

    return { errores, datos };
  }

  private parse(xml: string) {
    return new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;
  }

  async enviarFactura(xmlFirmado: string): Promise<ResultadoDian> {
    const doc = this.parse(xmlFirmado);
    const { errores, datos } = await this.reglasComunes(xmlFirmado, doc, "InvoiceLine");

    if (calcularCufe(datos, this.claveTecnica) !== texto(doc, NS.cbc, "UUID")) {
      errores.push({ regla: "SIM-CUFE", mensaje: "El CUFE no corresponde a los datos del documento" });
    }

    const prefijo = texto(doc, NS.sts, "Prefix");
    const consecutivo = Number(datos.numero.slice(prefijo.length));
    const desde = Number(texto(doc, NS.sts, "From"));
    const hasta = Number(texto(doc, NS.sts, "To"));

    if (!datos.numero.startsWith(prefijo) || consecutivo < desde || consecutivo > hasta) {
      errores.push({ regla: "SIM-RANGO", mensaje: "El numero no esta dentro del rango autorizado" });
    }

    return resultado(errores, `La Factura electronica ${datos.numero}, ha sido autorizada (ambiente simulado)`);
  }

  async enviarNotaCredito(xmlFirmado: string): Promise<ResultadoDian> {
    const doc = this.parse(xmlFirmado);
    const { errores, datos } = await this.reglasComunes(xmlFirmado, doc, "CreditNoteLine");

    if (calcularCude(datos, this.pinSoftware) !== texto(doc, NS.cbc, "UUID")) {
      errores.push({ regla: "SIM-CUDE", mensaje: "El CUDE no corresponde a los datos del documento" });
    }

    const referencia = doc.getElementsByTagNameNS(NS.cac, "InvoiceDocumentReference")[0];
    const cufeReferenciado = referencia?.getElementsByTagNameNS(NS.cbc, "UUID")[0]?.textContent?.trim() ?? "";

    if (!/^[0-9a-f]{96}$/.test(cufeReferenciado)) {
      errores.push({ regla: "SIM-REFERENCIA", mensaje: "La nota no referencia el CUFE de una factura electronica" });
    }

    if (!texto(doc, NS.cbc, "ResponseCode")) {
      errores.push({ regla: "SIM-CONCEPTO", mensaje: "Falta el concepto de correccion (DiscrepancyResponse)" });
    }

    return resultado(errores, `La Nota credito ${datos.numero}, ha sido autorizada (ambiente simulado)`);
  }
}
