import { describe, expect, it } from "vitest";

import { createCatalogoItemSchema } from "../src/modules/catalogo/catalogo.schemas.js";
import { createClienteSchema } from "../src/modules/clientes/clientes.schemas.js";
import { createMotocicletaSchema } from "../src/modules/motocicletas/motocicletas.schemas.js";
import {
  createOrdenDetalleSchema,
  createOrdenSchema,
  updateOrdenDetalleSchema,
} from "../src/modules/ordenes/ordenes.schemas.js";

describe("business validations", () => {
  it("rejects invalid client email", () => {
    expect(() =>
      createClienteSchema.parse({
        tipoIdentificacion: "CC",
        numeroIdentificacion: "1020304050",
        nombreRazonSocial: "Cliente Demo",
        email: "correo-invalido",
      }),
    ).toThrow();
  });

  it("normalizes motorcycle plate and rejects negative mileage", () => {
    expect(createMotocicletaSchema.parse({
      placa: "abc12d",
      marca: "Yamaha",
      modelo: "FZ",
      anio: 2022,
      kilometrajeActual: 0,
    }).placa).toBe("ABC12D");

    expect(() =>
      createMotocicletaSchema.parse({
        placa: "ABC12D",
        marca: "Yamaha",
        modelo: "FZ",
        anio: 2022,
        kilometrajeActual: -1,
      }),
    ).toThrow();
  });

  it("requires plate, brand, model and year for a motorcycle", () => {
    expect(() =>
      createMotocicletaSchema.parse({ placa: "ABC12D", marca: "Yamaha", modelo: "FZ" }),
    ).toThrow();
  });

  it("rejects motorcycle plates outside AAA00A format", () => {
    expect(() =>
      createMotocicletaSchema.parse({
        placa: "AB123C",
        marca: "Yamaha",
        modelo: "FZ",
      }),
    ).toThrow();
  });

  it("rejects non-taxed catalog items with iva rate", () => {
    expect(() =>
      createCatalogoItemSchema.parse({
        codigo: "REP-EXENTO",
        nombre: "Repuesto exento",
        tipo: "REPUESTO",
        precioVenta: 10000,
        tratamientoIva: "EXENTO",
        tarifaIva: 19,
      }),
    ).toThrow();
  });

  it("rejects order with motorcycle from invalid uuid and negative mileage", () => {
    expect(() =>
      createOrdenSchema.parse({
        clienteId: "not-a-uuid",
        motocicletaId: "550e8400-e29b-41d4-a716-446655440000",
        kilometrajeIngreso: -1,
        motivoIngreso: "Revision",
      }),
    ).toThrow();
  });

  it("rejects zero or negative quantities and negative prices in order items", () => {
    const itemCatalogoId = "550e8400-e29b-41d4-a716-446655440000";

    for (const cantidad of [0, "0.00", -1]) {
      expect(createOrdenDetalleSchema.safeParse({ itemCatalogoId, cantidad }).success).toBe(false);
      expect(updateOrdenDetalleSchema.safeParse({ cantidad }).success).toBe(false);
    }
    expect(createOrdenDetalleSchema.safeParse({ itemCatalogoId, precioAplicado: -100 }).success).toBe(
      false,
    );
    expect(createOrdenDetalleSchema.parse({ itemCatalogoId }).cantidad).toBe(1);
    expect(updateOrdenDetalleSchema.safeParse({ cantidad: "0.50" }).success).toBe(true);
  });
});

describe("repuesto de tercero", () => {
  const tercero = { descripcion: "Bujia NGK", proveedor: "Taller Pepe", precio: 15000 };

  it("acepta la linea de tercero con IVA GRAVADO 19 por defecto", () => {
    const r = createOrdenDetalleSchema.parse({ tercero, cantidad: 2 });
    expect(r).toMatchObject({ cantidad: 2, tercero: { tratamientoIva: "GRAVADO", tarifaIva: 19 } });
  });

  it("rechaza datos incompletos, excesos, IVA incoherente y mezclas con catalogo", () => {
    const itemCatalogoId = "550e8400-e29b-41d4-a716-446655440000";
    const malos = [
      { tercero: { ...tercero, proveedor: "" } },
      { tercero: { ...tercero, descripcion: "x".repeat(201) } },
      { tercero: { ...tercero, precio: -1 } },
      { tercero: { ...tercero, tratamientoIva: "EXENTO", tarifaIva: 19 } },
      { tercero: { ...tercero, tarifaIva: 10 } },
      { tercero: { ...tercero, extra: 1 } },
      { tercero, itemCatalogoId },
      { tercero, cantidad: 0 },
    ];
    for (const body of malos) expect(createOrdenDetalleSchema.safeParse(body).success).toBe(false);
  });
});
