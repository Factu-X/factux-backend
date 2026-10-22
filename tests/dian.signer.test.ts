import { beforeAll, describe, expect, it } from "vitest";

import { generarCertificadoPruebas } from "../src/modules/dian/certificado-pruebas.js";
import { firmarXml, leerCertificadoP12, verificarFirma, type Certificado } from "../src/modules/dian/signer.js";
import { construirFacturaXml } from "../src/modules/dian/ubl.js";
import { documentoDemo } from "./fixtures/dian.js";

let certificado: Certificado;

beforeAll(async () => {
  const p12 = generarCertificadoPruebas({ nombre: "Taller Test", nit: "900123456", password: "clave" });
  certificado = await leerCertificadoP12(p12, "clave");
}, 30_000);

describe("firma XAdES", () => {
  it("lee el certificado de pruebas", () => {
    expect(certificado.sujeto).toBe("Taller Test (PRUEBAS)");
    expect(certificado.venceEl.getTime()).toBeGreaterThan(Date.now());
  });

  it("rechaza una contrasena equivocada", async () => {
    const p12 = generarCertificadoPruebas({ nombre: "X", nit: "1", password: "buena" });
    await expect(leerCertificadoP12(p12, "mala")).rejects.toThrow();
  }, 30_000);

  it("firma dentro de la segunda extension con la politica DIAN y verifica", async () => {
    const { xml } = construirFacturaXml(documentoDemo());
    const firmado = await firmarXml(xml, certificado);

    expect(firmado).toContain("politicadefirmav2.pdf");
    expect(firmado).toMatch(/<ext:UBLExtension><ext:ExtensionContent><ds:Signature/);
    expect(await verificarFirma(firmado)).toBe(true);
  });

  it("detecta si alguien modifica el documento firmado", async () => {
    const { xml } = construirFacturaXml(documentoDemo());
    const firmado = await firmarXml(xml, certificado);
    const alterado = firmado.replace(">101630.00<", ">1.00<");

    expect(alterado).not.toBe(firmado);
    expect(await verificarFirma(alterado)).toBe(false);
  });
});
