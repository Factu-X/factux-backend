import { describe, expect, it } from "vitest";

import { renderFacturaPdf, type DatosPdf } from "../src/modules/dian/pdf.js";
import { documentoDemo } from "./fixtures/dian.js";

const datos = (extra: Partial<DatosPdf> = {}): DatosPdf => ({
  numero: "SETP990000001",
  fechaEmision: "2026-10-21 10:30",
  formaPago: "CONTADO",
  fechaVencimiento: null,
  estadoDian: "VALIDADA",
  cufe: "c".repeat(96),
  ambiente: "2",
  empresa: {
    razonSocial: "FactuX Moto Center",
    nit: "900123456",
    dv: "8",
    direccion: "Calle 10 #20-30",
    telefono: "3001234567",
    email: "contacto@factux.local",
    regimen: "Responsable de IVA",
  },
  resolucion: { numero: "18760000001", fecha: "2019-01-19", prefijo: "SETP", desde: 1, hasta: 100, vigenciaHasta: "2030-01-19" },
  cliente: { nombre: "Carlos Perez", documento: "CC 1020304050", email: "c@x.co", telefono: "300" },
  orden: { numero: "OS-1", placa: "ABC12D", vehiculo: "Honda CB 2020", kilometraje: 12000 },
  lineas: documentoDemo().lineas,
  totales: { subtotal: "87000.00", impuestos: "14630.00", total: "101630.00" },
  ...extra,
});

// PDFKit comprime los streams; se inspecciona el diccionario /Info (sin comprimir) y el tamano.
const texto = (pdf: Buffer) => pdf.toString("latin1");

describe("renderFacturaPdf", () => {
  it("genera un PDF valido de factura con titulo y paginas", async () => {
    const pdf = await renderFacturaPdf(datos());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2000);
    expect(texto(pdf)).toContain("%%EOF");
    expect(texto(pdf)).toContain("Factura SETP990000001");
    expect(texto(pdf)).toContain("/Type /Page");
  });

  it("incluye la imagen del QR solo cuando hay CUFE", async () => {
    const con = await renderFacturaPdf(datos());
    const sin = await renderFacturaPdf(datos({ cufe: null, estadoDian: "PENDIENTE_ENVIO" }));
    expect(texto(con)).toContain("/Subtype /Image");
    expect(texto(sin)).not.toContain("/Subtype /Image");
  });

  it("maneja campos opcionales ausentes, credito, ambiente de produccion y lineas largas", async () => {
    const base = datos();
    const pdf = await renderFacturaPdf(
      datos({
        formaPago: "CREDITO",
        fechaVencimiento: "2026-11-21",
        ambiente: "1",
        estadoDian: "OTRO",
        resolucion: null,
        empresa: { ...base.empresa, dv: null, regimen: null, direccion: null, telefono: null, email: null },
        cliente: { ...base.cliente, email: null, telefono: null },
        lineas: [
          { ...base.lineas[0]!, codigo: null, descripcion: "Descripcion muy larga ".repeat(20) },
          { ...base.lineas[2]! },
        ],
      }),
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("genera una nota credito con su propio titulo y concepto", async () => {
    const pdf = await renderFacturaPdf(
      datos({
        numero: "NC-000001",
        notaCredito: {
          facturaNumero: "SETP990000001",
          facturaCufe: "a".repeat(96),
          concepto: "Devolucion de parte de los bienes",
          motivo: "Aceite no usado",
        },
      }),
    );
    expect(texto(pdf)).toContain("Nota credito NC-000001");
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("nota credito sin CUFE de la factura y sin CUDE sigue generando PDF", async () => {
    const pdf = await renderFacturaPdf(
      datos({
        cufe: null,
        notaCredito: { facturaNumero: "F1", facturaCufe: null, concepto: "c", motivo: "m" },
      }),
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("muchas lineas producen un PDF mas grande que pocas", async () => {
    const base = datos();
    const muchas = await renderFacturaPdf(datos({ lineas: Array.from({ length: 30 }, () => base.lineas[0]!) }));
    const una = await renderFacturaPdf(datos({ lineas: [base.lineas[0]!] }));
    expect(muchas.length).toBeGreaterThan(una.length);
  });
});
