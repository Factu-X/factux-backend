import { describe, expect, it } from "vitest";

import { createCatalogoItemSchema } from "../src/modules/catalogo/catalogo.schemas.js";
import { createClienteSchema } from "../src/modules/clientes/clientes.schemas.js";
import { createMotocicletaSchema } from "../src/modules/motocicletas/motocicletas.schemas.js";
import { createOrdenSchema } from "../src/modules/ordenes/ordenes.schemas.js";

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
      kilometrajeActual: 0,
    }).placa).toBe("ABC12D");

    expect(() =>
      createMotocicletaSchema.parse({
        placa: "ABC12D",
        marca: "Yamaha",
        modelo: "FZ",
        kilometrajeActual: -1,
      }),
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
});
