import "temporal-polyfill/global";
import { describe, expect, it } from "vitest";

import { antiguedad, centavos, estadoCuenta } from "../src/modules/cartera/cartera.rules.js";
import { calcularLineasNota, disponiblesPorLinea, type LineaFacturada } from "../src/modules/notas-credito/notas-credito.rules.js";
import { rangoDelReporte } from "../src/modules/reportes/reportes.service.js";

const lineas: LineaFacturada[] = [
  { id: "a", codigoItem: "SERV", descripcion: "Mantenimiento", cantidad: "1.00", precioUnitario: "120000.00", tarifaIva: "19.00", tratamientoIva: "GRAVADO" },
  { id: "b", codigoItem: "REP", descripcion: "Filtro", cantidad: "3.00", precioUnitario: "18000.00", tarifaIva: "19.00", tratamientoIva: "GRAVADO" },
  { id: "c", codigoItem: "EXC", descripcion: "Tramite", cantidad: "1.00", precioUnitario: "10000.00", tarifaIva: "0.00", tratamientoIva: "EXCLUIDO" },
];

describe("notas credito: cantidades disponibles", () => {
  it("resta lo que ya acreditaron notas anteriores", () => {
    const disponibles = disponiblesPorLinea(lineas, [{ detalleFacturaId: "b", cantidad: "2.00" }]);
    expect(disponibles.get("a")).toBe(100n);
    expect(disponibles.get("b")).toBe(100n);
  });
});

describe("notas credito: calculo de lineas", () => {
  it("una nota total acredita todo lo disponible con su IVA", () => {
    const { lineas: nota, totales } = calcularLineasNota("TOTAL", lineas, []);
    expect(nota.map((l) => [l.detalleFacturaId, l.cantidad])).toEqual([["a", "1.00"], ["b", "3.00"], ["c", "1.00"]]);
    expect(totales).toEqual({ subtotal: "184000.00", impuestos: "33060.00", total: "217060.00" });
  });

  it("una nota total despues de una parcial solo toma el resto", () => {
    const { lineas: nota } = calcularLineasNota("TOTAL", lineas, [{ detalleFacturaId: "b", cantidad: "2.00" }]);
    expect(nota.find((l) => l.detalleFacturaId === "b")?.cantidad).toBe("1.00");
  });

  it("una nota parcial calcula solo las lineas pedidas", () => {
    const { totales } = calcularLineasNota("PARCIAL", lineas, [], [{ detalleFacturaId: "b", cantidad: 1 }]);
    expect(totales).toEqual({ subtotal: "18000.00", impuestos: "3420.00", total: "21420.00" });
  });

  it("rechaza acreditar mas de lo disponible", () => {
    expect(() =>
      calcularLineasNota("PARCIAL", lineas, [{ detalleFacturaId: "b", cantidad: "2.00" }], [{ detalleFacturaId: "b", cantidad: 2 }]),
    ).toThrow('Solo quedan 1.00 de "Filtro" por acreditar');
  });

  it("rechaza lineas ajenas, repetidas o una factura ya acreditada", () => {
    expect(() => calcularLineasNota("PARCIAL", lineas, [], [{ detalleFacturaId: "x", cantidad: 1 }])).toThrow("no pertenece");
    expect(() =>
      calcularLineasNota("PARCIAL", lineas, [], [{ detalleFacturaId: "a", cantidad: 0.5 }, { detalleFacturaId: "a", cantidad: 0.5 }]),
    ).toThrow("solo puede aparecer una vez");
    const todo = lineas.map((l) => ({ detalleFacturaId: l.id, cantidad: l.cantidad }));
    expect(() => calcularLineasNota("TOTAL", lineas, todo)).toThrow("totalmente acreditada");
  });
});

describe("cartera", () => {
  const hoy = Temporal.PlainDate.from("2026-10-22");
  const base = { total: "100000.00", vencimiento: Temporal.PlainDate.from("2026-10-01"), hoy };

  it("clasifica la antiguedad de la deuda", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91].map(antiguedad)).toEqual([
      "AL_DIA", "D1_30", "D1_30", "D31_60", "D31_60", "D61_90", "D61_90", "MAS_90",
    ]);
  });

  it("descuenta pagos y notas credito del saldo", () => {
    expect(estadoCuenta({ ...base, acreditado: centavos("20000"), pagado: centavos("30000") })).toMatchObject({
      saldo: "50000.00",
      diasVencida: 21,
      antiguedad: "D1_30",
      estadoPago: "PARCIAL",
    });
  });

  it("una factura pagada o anulada no queda vencida", () => {
    expect(estadoCuenta({ ...base, acreditado: 0n, pagado: centavos("100000") })).toMatchObject({ saldo: "0.00", diasVencida: 0, estadoPago: "PAGADA" });
    expect(estadoCuenta({ ...base, acreditado: centavos("100000"), pagado: 0n })).toMatchObject({ saldo: "0.00", estadoPago: "ANULADA" });
  });

  it("el saldo nunca es negativo", () => {
    expect(estadoCuenta({ ...base, acreditado: centavos("50000"), pagado: centavos("100000") }).saldo).toBe("0.00");
  });
});

describe("rango del reporte", () => {
  const hoy = Temporal.PlainDate.from("2026-10-22");

  it("por defecto toma el mes en curso hasta hoy", () => {
    const { desde, hasta } = rangoDelReporte({}, hoy);
    expect([desde.toString(), hasta.toString()]).toEqual(["2026-10-01", "2026-10-22"]);
  });

  it("incluye el dia final completo en hora de Colombia", () => {
    const { inicio, fin } = rangoDelReporte({ desde: "2026-10-01", hasta: "2026-10-01" }, hoy);
    expect([inicio.toString(), fin.toString()]).toEqual(["2026-10-01T05:00:00Z", "2026-10-02T05:00:00Z"]);
  });

  it("rechaza rangos invertidos o de mas de un año", () => {
    expect(() => rangoDelReporte({ desde: "2026-10-10", hasta: "2026-10-01" }, hoy)).toThrow("anterior");
    expect(() => rangoDelReporte({ desde: "2024-01-01", hasta: "2026-01-01" }, hoy)).toThrow("un año");
  });
});
