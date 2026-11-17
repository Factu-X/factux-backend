import "temporal-polyfill/global";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  upload: vi.fn(),
  download: vi.fn(),
  from: vi.fn(),
}));

vi.mock("../src/modules/configuracion/configuracion.service.js", () => ({
  BUCKET_PRIVADO: "factux-privado",
  requireSecretsClient: () => ({ storage: { from: m.from } }),
}));

import { generarCertificadoPruebas } from "../src/modules/dian/certificado-pruebas.js";
import { SimuladorDianGateway } from "../src/modules/dian/gateway.js";
import { cargarCertificado, firmarXml, leerCertificadoP12, verificarFirma, type Certificado } from "../src/modules/dian/signer.js";
import { guardarDocumento, leerDocumento } from "../src/modules/dian/storage.js";
import { construirNotaCreditoXml } from "../src/modules/dian/ubl-nota-credito.js";
import { buildFacturaXml } from "../src/modules/facturas/facturas.xml.js";
import { documentoDemo, facturaDemo } from "./fixtures/dian.js";

describe("dian.storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.from.mockReturnValue({ upload: m.upload, download: m.download });
  });

  it("guarda en el bucket privado con upsert y devuelve la ruta", async () => {
    m.upload.mockResolvedValue({ error: null });
    expect(await guardarDocumento("facturas/a.xml", "<x/>", "application/xml")).toBe("facturas/a.xml");
    expect(m.from).toHaveBeenCalledWith("factux-privado");
    expect(m.upload).toHaveBeenCalledWith("facturas/a.xml", "<x/>", { contentType: "application/xml", upsert: true });
  });

  it("propaga el error de subida", async () => {
    m.upload.mockResolvedValue({ error: new Error("sin cuota") });
    await expect(guardarDocumento("a", "b", "text/plain")).rejects.toThrow("sin cuota");
  });

  it("lee un documento como Buffer", async () => {
    m.download.mockResolvedValue({ data: { arrayBuffer: async () => Buffer.from("hola") }, error: null });
    expect((await leerDocumento("a")).toString()).toBe("hola");
  });

  it("propaga el error de descarga", async () => {
    m.download.mockResolvedValue({ data: null, error: new Error("no existe") });
    await expect(leerDocumento("a")).rejects.toThrow("no existe");
  });
});

describe("signer y gateway: casos limite", () => {
  let certificado: Certificado;
  const doc = documentoDemo();
  const gateway = new SimuladorDianGateway(doc.claveTecnica, doc.software.pin);

  beforeAll(async () => {
    certificado = await leerCertificadoP12(generarCertificadoPruebas({ nombre: "Taller", nit: "900123456", password: "x" }), "x");
  }, 30_000);

  it("verificarFirma devuelve false si el XML no tiene firma", async () => {
    expect(await verificarFirma(buildFacturaXml(facturaDemo()).xml)).toBe(false);
  });

  it("firmarXml falla si el XML no tiene la segunda extension de firma", async () => {
    const sinExtension = '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>1</ID></Invoice>';
    await expect(firmarXml(sinExtension, certificado)).rejects.toThrow();
  });

  it("cargarCertificado lee un .p12 desde disco", async () => {
    const { writeFile, mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "factux-p12-"));
    try {
      const ruta = join(dir, "c.p12");
      await writeFile(ruta, generarCertificadoPruebas({ nombre: "Disco", nit: "1", password: "pw" }));
      expect((await cargarCertificado(ruta, "pw")).sujeto).toBe("Disco (PRUEBAS)");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("leerCertificadoP12 rechaza un archivo que no es PKCS#12", async () => {
    await expect(leerCertificadoP12(Buffer.from("no soy un p12"), "x")).rejects.toThrow();
  });

  it("el simulador rechaza totales que no suman (SIM-TOTAL) y firma invalida", async () => {
    const firmado = await firmarXml(buildFacturaXml(facturaDemo()).xml, certificado);
    const roto = firmado.replace(/<cbc:PayableAmount([^>]*)>[\d.]+</, "<cbc:PayableAmount$1>1.00<");
    expect(roto).not.toBe(firmado);
    const r = await gateway.enviarFactura(roto);
    expect(r.estado).toBe("RECHAZADO");
    expect(r.errores.map((e) => e.regla)).toEqual(expect.arrayContaining(["SIM-TOTAL", "SIM-FIRMA"]));
  });

  it("el simulador rechaza LineCountNumeric inconsistente (SIM-LINEAS)", async () => {
    const firmado = await firmarXml(buildFacturaXml(facturaDemo()).xml, certificado);
    const roto = firmado.replace(/<cbc:LineCountNumeric>\d+</, "<cbc:LineCountNumeric>9<");
    expect(roto).not.toBe(firmado);
    const r = await gateway.enviarFactura(roto);
    expect(r.errores.map((e) => e.regla)).toContain("SIM-LINEAS");
  });

  it("el simulador exige el concepto de correccion en la nota credito (SIM-CONCEPTO)", async () => {
    const base = documentoDemo();
    const { xml } = construirNotaCreditoXml({
      numero: "NC-1",
      emitidaEn: Temporal.Instant.from("2026-10-22T18:00:00Z"),
      tipoAjuste: "PARCIAL",
      motivo: "m",
      factura: { numero: "SETP990000001", cufe: "a".repeat(96), fechaEmision: "2026-10-22" },
      emisor: base.emisor,
      adquirente: base.adquirente,
      lineas: [base.lineas[1]!],
      ambiente: "2",
      software: base.software,
    });
    const sinConcepto = xml.replace(/<cbc:ResponseCode>\d<\/cbc:ResponseCode>/, "");
    expect(sinConcepto).not.toBe(xml);
    const r = await gateway.enviarNotaCredito(await firmarXml(sinConcepto, certificado));
    expect(r.errores.map((e) => e.regla)).toContain("SIM-CONCEPTO");
  });
});
