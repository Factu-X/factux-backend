import { beforeAll, describe, expect, it } from "vitest";

import { generarCertificadoPruebas } from "../src/modules/dian/certificado-pruebas.js";
import { SimuladorDianGateway } from "../src/modules/dian/gateway.js";
import { firmarXml, leerCertificadoP12, type Certificado } from "../src/modules/dian/signer.js";
import { buildFacturaXml } from "../src/modules/facturas/facturas.xml.js";
import { documentoDemo, facturaDemo } from "./fixtures/dian.js";

let certificado: Certificado;
const gateway = new SimuladorDianGateway(documentoDemo().claveTecnica, documentoDemo().software.pin);

beforeAll(async () => {
  certificado = await leerCertificadoP12(
    generarCertificadoPruebas({ nombre: "Taller", nit: "900123456", password: "x" }),
    "x",
  );
}, 30_000);

// Firma el XML que genera HU-06: el mismo que se transmite en produccion.
const firmar = async (doc = facturaDemo()) => firmarXml(buildFacturaXml(doc).xml, certificado);

describe("simulador DIAN", () => {
  it("valida una factura correcta", async () => {
    const resultado = await gateway.enviarFactura(await firmar());
    expect(resultado).toMatchObject({ estado: "VALIDADO", codigo: "00", errores: [] });
  });

  it("rechaza un numero fuera del rango autorizado", async () => {
    const doc = facturaDemo({ numero: "SETP1" });
    const resultado = await gateway.enviarFactura(await firmar(doc));
    expect(resultado.estado).toBe("RECHAZADO");
    expect(resultado.errores.map((e) => e.regla)).toEqual(["SIM-RANGO"]);
  });

  it("rechaza un CUFE calculado con otra clave tecnica", async () => {
    const doc = facturaDemo({ claveTecnica: "otra-clave" });
    const resultado = await gateway.enviarFactura(await firmar(doc));
    expect(resultado.errores.map((e) => e.regla)).toEqual(["SIM-CUFE"]);
  });

  it("rechaza un documento alterado despues de firmar", async () => {
    const alterado = (await firmar()).replace(">Carlos Perez<", ">Otra Persona<");
    const resultado = await gateway.enviarFactura(alterado);
    expect(resultado.errores.map((e) => e.regla)).toContain("SIM-FIRMA");
  });
});
