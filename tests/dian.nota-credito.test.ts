import "temporal-polyfill/global";
import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";

import { generarCertificadoPruebas } from "../src/modules/dian/certificado-pruebas.js";
import { SimuladorDianGateway } from "../src/modules/dian/gateway.js";
import { firmarXml, leerCertificadoP12, type Certificado } from "../src/modules/dian/signer.js";
import { construirNotaCreditoXml, NS_NOTA_CREDITO, type DocumentoNotaCredito } from "../src/modules/dian/ubl-nota-credito.js";
import { NS } from "../src/modules/dian/ubl.js";
import { documentoDemo } from "./fixtures/dian.js";

const base = documentoDemo();
const nota = (): DocumentoNotaCredito => ({
  numero: "NC-000001",
  emitidaEn: Temporal.Instant.from("2026-10-22T18:00:00Z"),
  tipoAjuste: "PARCIAL",
  motivo: "Devolucion del aceite no usado",
  factura: { numero: "SETP990000001", cufe: "a".repeat(96), fechaEmision: "2026-10-22" },
  emisor: base.emisor,
  adquirente: base.adquirente,
  lineas: [base.lineas[1]!],
  ambiente: "2",
  software: base.software,
});

let certificado: Certificado;
const gateway = new SimuladorDianGateway(base.claveTecnica, base.software.pin);

beforeAll(async () => {
  certificado = await leerCertificadoP12(generarCertificadoPruebas({ nombre: "Taller", nit: "900123456", password: "x" }), "x");
}, 30_000);

const text = (doc: Document, ns: string, name: string) => doc.getElementsByTagNameNS(ns, name)[0]?.textContent;

describe("nota credito UBL 2.1", () => {
  it("referencia la factura, el concepto y usa CUDE", () => {
    const { xml, cude } = construirNotaCreditoXml(nota());
    const doc = new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;

    expect(doc.documentElement.namespaceURI).toBe(NS_NOTA_CREDITO);
    expect(text(doc, NS.cbc, "UUID")).toBe(cude);
    expect(xml).toContain('schemeName="CUDE-SHA384"');
    expect(text(doc, NS.cbc, "CustomizationID")).toBe("20");
    expect(text(doc, NS.cbc, "ResponseCode")).toBe("1");
    expect(text(doc, NS.cbc, "ReferenceID")).toBe("SETP990000001");
    expect(doc.getElementsByTagNameNS(NS.cac, "CreditNoteLine")).toHaveLength(1);
    expect(text(doc, NS.cbc, "PayableAmount")).toBe("49980.00");
  });

  it("una nota total usa el concepto de anulacion", () => {
    const { xml } = construirNotaCreditoXml({ ...nota(), tipoAjuste: "TOTAL" });
    expect(xml).toContain("<cbc:ResponseCode>2</cbc:ResponseCode>");
  });

  it("el simulador valida la nota firmada y rechaza un CUDE con otro PIN", async () => {
    const valida = await gateway.enviarNotaCredito(await firmarXml(construirNotaCreditoXml(nota()).xml, certificado));
    expect(valida).toMatchObject({ estado: "VALIDADO", codigo: "00" });

    const otroPin = { ...nota(), software: { ...base.software, pin: "99999" } };
    const rechazada = await gateway.enviarNotaCredito(await firmarXml(construirNotaCreditoXml(otroPin).xml, certificado));
    expect(rechazada.errores.map((e) => e.regla)).toEqual(["SIM-CUDE"]);
  });

  it("el simulador exige la referencia al CUFE de la factura", async () => {
    const sinReferencia = { ...nota(), factura: { ...nota().factura, cufe: "no-es-un-cufe" } };
    const resultado = await gateway.enviarNotaCredito(await firmarXml(construirNotaCreditoXml(sinReferencia).xml, certificado));
    expect(resultado.errores.map((e) => e.regla)).toContain("SIM-REFERENCIA");
  });
});
