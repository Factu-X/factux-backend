import "temporal-polyfill/global";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const T = vi.hoisted(() => {
  const TERMINALES = new Set(["all", "aggregate"]);
  const deep: unknown = new Proxy(function () {}, { get: (_t, p) => (p === "then" ? undefined : deep), apply: () => deep });
  const modelos: Record<string, ReturnType<typeof vi.fn>> = {};
  const modelo = (nombre: string) => {
    modelos[nombre] = vi.fn();
    const cadena: unknown = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return undefined;
        if (TERMINALES.has(prop)) return () => modelos[nombre]!();
        return (...args: unknown[]) => {
          for (const a of args) if (typeof a === "function") a(deep);
          return cadena;
        };
      },
    });
    return cadena;
  };
  const db = { orm: { public: Object.fromEntries(["Facturas", "NotasCredito", "Pagos", "OrdenesServicio"].map((n) => [n, modelo(n)])) } };
  return { db, modelos, getCartera: vi.fn() };
});

vi.mock("@prisma/orm-postgres/orm-client", () => ({ and: (...a: unknown[]) => a }));
vi.mock("../src/prisma/db.js", () => ({ db: T.db }));
vi.mock("../src/modules/cartera/cartera.service.js", () => ({ getCartera: T.getCartera }));

const { getReporteFacturacion, rangoDelReporte } = await import("../src/modules/reportes/reportes.service.js");

beforeAll(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-16T17:00:00Z") }));
afterAll(() => vi.useRealTimers());

const instante = (s: string) => Temporal.Instant.from(s);
const fact = (id: string, total: string, cuando: string, extra: Record<string, unknown> = {}) => ({
  id, clienteId: "c1", total, subtotal: total, impuestos: "0.00", fechaEmision: instante(cuando), estadoDian: "VALIDADA", formaPago: "CONTADO",
  cliente: { nombreRazonSocial: "Ana", numeroIdentificacion: "123" }, detallesFacturas: [], ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  T.getCartera.mockResolvedValue({ resumen: { porCobrar: "5.00" } });
  T.modelos["Facturas"]!.mockResolvedValue([]);
  T.modelos["NotasCredito"]!.mockResolvedValue([]);
  T.modelos["Pagos"]!.mockResolvedValue([]);
  T.modelos["OrdenesServicio"]!.mockResolvedValue({ total: 0 });
});

describe("reportes: rango", () => {
  it("por defecto es el mes en curso hasta hoy (hora Colombia)", () => {
    const r = rangoDelReporte({}, Temporal.PlainDate.from("2026-11-16"));
    expect([r.desde.toString(), r.hasta.toString()]).toEqual(["2026-11-01", "2026-11-16"]);
    // el rango es [inicio, fin) en UTC-5
    expect(r.inicio.toString()).toBe("2026-11-01T05:00:00Z");
    expect(r.fin.toString()).toBe("2026-11-17T05:00:00Z");
  });

  it("rechaza desde > hasta y rangos de mas de un año, y acepta el limite de 366 dias", () => {
    expect(() => rangoDelReporte({ desde: "2026-11-10", hasta: "2026-11-09" })).toThrow(/anterior o igual/);
    expect(() => rangoDelReporte({ desde: "2025-01-01", hasta: "2026-01-03" })).toThrow(/un año/);
    expect(() => rangoDelReporte({ desde: "2025-01-01", hasta: "2026-01-03" })).toThrowError(expect.objectContaining({ statusCode: 400 }));
    expect(() => rangoDelReporte({ desde: "2025-01-01", hasta: "2026-01-02" })).not.toThrow();
    expect(rangoDelReporte({ desde: "2026-11-05", hasta: "2026-11-05" }).desde.toString()).toBe("2026-11-05");
  });

  it("usa hoy real cuando no se pasa fecha de referencia", () => {
    expect(rangoDelReporte({}).hasta.toString()).toBe("2026-11-16");
  });
});

describe("reportes: getReporteFacturacion", () => {
  it("sin datos devuelve ceros, ticket promedio 0 y una serie con todos los dias", async () => {
    const r = await getReporteFacturacion({ desde: "2026-11-01", hasta: "2026-11-03" });
    expect(r.totales).toEqual({
      facturas: 0, facturado: "0.00", subtotal: "0.00", iva: "0.00", notasCredito: "0.00", neto: "0.00", recaudado: "0.00", ordenesFinalizadas: 0, ticketPromedio: "0.00",
    });
    expect(r.serie).toEqual([
      { fecha: "2026-11-01", facturas: 0, total: "0.00" },
      { fecha: "2026-11-02", facturas: 0, total: "0.00" },
      { fecha: "2026-11-03", facturas: 0, total: "0.00" },
    ]);
    expect(r.topItems).toEqual([]);
    expect(r.recaudoPorMetodo).toEqual({});
    expect(r.cartera).toEqual({ porCobrar: "5.00" });
    expect(T.getCartera).toHaveBeenCalledWith({ filtro: "CON_SALDO" });
  });

  it("totaliza facturado, IVA, notas, neto, recaudo y ticket promedio (truncado) sin error de redondeo", async () => {
    T.modelos["Facturas"]!.mockResolvedValue([
      fact("f1", "50.00", "2026-11-01T15:00:00Z", { subtotal: "42.02", impuestos: "7.98" }),
      fact("f2", "30.00", "2026-11-01T16:00:00Z", { subtotal: "30.00" }),
      fact("f3", "20.01", "2026-11-03T15:00:00Z", { subtotal: "20.01", estadoDian: "RECHAZADA", formaPago: "CREDITO" }),
    ]);
    T.modelos["NotasCredito"]!.mockResolvedValue([{ total: "10.10" }, { total: "0.01" }]);
    T.modelos["Pagos"]!.mockResolvedValue([
      { monto: "40.00", metodoPago: "EFECTIVO" }, { monto: "10.50", metodoPago: "EFECTIVO" }, { monto: "5.25", metodoPago: "TARJETA" },
    ]);
    T.modelos["OrdenesServicio"]!.mockResolvedValue({ total: 4 });
    const r = await getReporteFacturacion({ desde: "2026-11-01", hasta: "2026-11-03" });
    expect(r.totales).toMatchObject({
      ordenesFinalizadas: 4,
      facturas: 3, facturado: "100.01", subtotal: "92.03", iva: "7.98", notasCredito: "10.11", neto: "89.90", recaudado: "55.75",
      ticketPromedio: "33.33",
    });
    expect(r.porEstadoDian).toEqual({ VALIDADA: 2, RECHAZADA: 1 });
    expect(r.porFormaPago).toEqual({ CONTADO: 2, CREDITO: 1 });
    expect(r.recaudoPorMetodo).toEqual({ EFECTIVO: "50.50", TARJETA: "5.25" });
    expect(r.serie.map((s) => [s.fecha, s.facturas, s.total])).toEqual([
      ["2026-11-01", 2, "80.00"], ["2026-11-02", 0, "0.00"], ["2026-11-03", 1, "20.01"],
    ]);
  });

  it("agrupa la serie por dia de Colombia, no por dia UTC", async () => {
    // 02:00 UTC del 2 de noviembre = 21:00 del 1 de noviembre en Bogota
    T.modelos["Facturas"]!.mockResolvedValue([fact("f1", "10.00", "2026-11-02T02:00:00Z")]);
    const r = await getReporteFacturacion({ desde: "2026-11-01", hasta: "2026-11-02" });
    expect(r.serie.map((s) => s.facturas)).toEqual([1, 0]);
  });

  it("top de productos: agrupa por codigo o descripcion, ordena por total y corta en 8", async () => {
    const lineas = Array.from({ length: 10 }, (_, i) => ({
      codigoItem: `P${i}`, descripcion: `Item ${i}`, cantidad: "1.00", total: `${(i + 1) * 100}.00`,
    }));
    lineas.push({ codigoItem: null as unknown as string, descripcion: "Mano de obra", cantidad: "2.50", total: "1500.00" });
    lineas.push({ codigoItem: null as unknown as string, descripcion: "Mano de obra", cantidad: "0.50", total: "50.00" });
    lineas.push({ codigoItem: "P9", descripcion: "Item 9", cantidad: "1.00", total: "10.00" });
    T.modelos["Facturas"]!.mockResolvedValue([fact("f1", "1.00", "2026-11-05T15:00:00Z", { detallesFacturas: lineas })]);
    const r = await getReporteFacturacion({ desde: "2026-11-05", hasta: "2026-11-05" });
    expect(r.topItems).toHaveLength(8);
    expect(r.topItems[0]).toEqual({ codigo: null, descripcion: "Mano de obra", cantidad: "3.00", total: "1550.00" });
    expect(r.topItems[1]).toEqual({ codigo: "P9", descripcion: "Item 9", cantidad: "2.00", total: "1010.00" });
    expect(r.topItems.at(-1)!.codigo).toBe("P3");
  });

  it("top de clientes: ordena por total, corta en 5 y tolera cliente nulo", async () => {
    const facturas = ["a", "b", "c", "d", "e", "f"].map((id, i) =>
      fact(id, `${(i + 1) * 10}.00`, "2026-11-05T15:00:00Z", {
        clienteId: id, cliente: id === "f" ? null : { nombreRazonSocial: `Cliente ${id}`, numeroIdentificacion: `${i}` },
      }),
    );
    facturas.push(fact("g", "5.00", "2026-11-05T16:00:00Z", { clienteId: "a", cliente: { nombreRazonSocial: "Cliente a", numeroIdentificacion: "0" } }));
    T.modelos["Facturas"]!.mockResolvedValue(facturas);
    const r = await getReporteFacturacion({ desde: "2026-11-05", hasta: "2026-11-05" });
    expect(r.topClientes.map((c) => c.id)).toEqual(["f", "e", "d", "c", "b"]);
    expect(r.topClientes[0]).toEqual({ id: "f", nombre: "", documento: "", facturas: 1, total: "60.00" });
  });

  it("mismo total en clientes distintos conserva ambos (empate estable)", async () => {
    T.modelos["Facturas"]!.mockResolvedValue([
      fact("a", "10.00", "2026-11-05T15:00:00Z", { clienteId: "x" }),
      fact("b", "10.00", "2026-11-05T15:00:00Z", { clienteId: "y" }),
    ]);
    const r = await getReporteFacturacion({ desde: "2026-11-05", hasta: "2026-11-05" });
    expect(r.topClientes.map((c) => c.id)).toEqual(["x", "y"]);
  });

  it("propaga el 400 del rango invalido sin consultar la base", async () => {
    await expect(getReporteFacturacion({ desde: "2026-11-10", hasta: "2026-11-01" })).rejects.toMatchObject({ statusCode: 400 });
    expect(T.modelos["Facturas"]).not.toHaveBeenCalled();
  });
});
