import { describe, expect, it } from "vitest";

import {
  calculateDetalle,
  sumCalculatedDetalles,
} from "../src/modules/ordenes/ordenes.calculations.js";
import { canModifyOrden } from "../src/modules/ordenes/ordenes.policy.js";

describe("order calculations", () => {
  it("calculates subtotal, iva and total for taxed items", () => {
    expect(
      calculateDetalle({
        cantidad: 2,
        precioUnitario: 10000,
        tratamientoIva: "GRAVADO",
        tarifaIva: 19,
      }),
    ).toMatchObject({
      subtotal: "20000.00",
      impuesto: "3800.00",
      total: "23800.00",
    });
  });

  it("does not calculate tax for EXENTO or EXCLUIDO items", () => {
    expect(
      calculateDetalle({
        cantidad: 1,
        precioUnitario: 50000,
        tratamientoIva: "EXENTO",
        tarifaIva: 0,
      }).impuesto,
    ).toBe("0.00");

    expect(
      calculateDetalle({
        cantidad: 1,
        precioUnitario: 50000,
        tratamientoIva: "EXCLUIDO",
        tarifaIva: 0,
      }).impuesto,
    ).toBe("0.00");
  });

  it("uses the applied price override in calculations", () => {
    expect(
      calculateDetalle({
        cantidad: "1.50",
        precioUnitario: "80000.00",
        tratamientoIva: "GRAVADO",
        tarifaIva: "19.00",
      }),
    ).toMatchObject({
      subtotal: "120000.00",
      impuesto: "22800.00",
      total: "142800.00",
    });
  });

  it("sums order totals from details", () => {
    expect(
      sumCalculatedDetalles([
        { subtotal: "20000.00", impuesto: "3800.00", total: "23800.00" },
        { subtotal: "5000.00", impuesto: "0.00", total: "5000.00" },
      ]),
    ).toEqual({
      subtotal: "25000.00",
      impuestos: "3800.00",
      total: "28800.00",
    });
  });

  it("blocks changes to finalized and cancelled orders", () => {
    expect(canModifyOrden("ABIERTA")).toBe(true);
    expect(canModifyOrden("EN_PROCESO")).toBe(true);
    expect(canModifyOrden("FINALIZADA")).toBe(false);
    expect(canModifyOrden("CANCELADA")).toBe(false);
  });
});
