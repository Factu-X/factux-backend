import "temporal-polyfill/global";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const T = vi.hoisted(() => {
  const TERMINALES = new Set(["all", "first", "update", "create"]);
  const deep: unknown = new Proxy(function () {}, { get: (_t, p) => (p === "then" ? undefined : deep), apply: () => deep });
  const modelos: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
  const modelo = (nombre: string) => {
    modelos[nombre] = Object.fromEntries([...TERMINALES].map((t) => [t, vi.fn()]));
    const cadena: unknown = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return undefined;
        if (TERMINALES.has(prop)) {
          return (...args: unknown[]) => {
            for (const a of args) if (typeof a === "function") a(deep);
            return modelos[nombre]![prop]!(...args);
          };
        }
        return (...args: unknown[]) => {
          for (const a of args) if (typeof a === "function") a(deep);
          return cadena;
        };
      },
    });
    return cadena;
  };
  const db: Record<string, unknown> = {};
  db["orm"] = { public: Object.fromEntries(["Facturas", "NotasCredito", "Pagos"].map((n) => [n, modelo(n)])) };
  db["transaction"] = (fn: (tx: unknown) => unknown) => fn(db);
  return { db, modelos, getFacturaById: vi.fn() };
});

vi.mock("../src/prisma/db.js", () => ({ db: T.db }));
vi.mock("../src/modules/facturas/facturas.service.js", () => ({ getFacturaById: T.getFacturaById }));

const svc = await import("../src/modules/cartera/cartera.service.js");
const rules = await import("../src/modules/cartera/cartera.rules.js");
const ctl = await import("../src/modules/cartera/cartera.controller.js");

const m = (n: string) => T.modelos[n]!;
const FACT = "550e8400-e29b-41d4-a716-446655440000";
// "Hoy" fijo en Colombia: 2026-11-16 12:00.
beforeAll(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-16T17:00:00Z") }));
afterAll(() => vi.useRealTimers());

const factura = (id: string, total: string, vence: string | null, extra: Record<string, unknown> = {}) => ({
  id, numero: "F-" + id, total, fechaEmision: Temporal.Instant.from("2026-01-02T15:00:00Z"),
  fechaVencimiento: vence ? Temporal.PlainDate.from(vence) : null, formaPago: "CREDITO", estadoDian: "VALIDADA",
  cliente: { id: "c", nombreRazonSocial: "Ana" }, ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("cartera: antiguedad por dias de mora", () => {
  it("clasifica los limites de cada tramo", () => {
    const casos: [number, string][] = [
      [-5, "AL_DIA"], [0, "AL_DIA"], [1, "D1_30"], [30, "D1_30"], [31, "D31_60"], [60, "D31_60"],
      [61, "D61_90"], [90, "D61_90"], [91, "MAS_90"], [400, "MAS_90"],
    ];
    for (const [dias, esperado] of casos) expect(rules.antiguedad(dias)).toBe(esperado);
  });

  it("estadoCuenta: saldo nunca negativo, estados y dias vencidos", () => {
    const base = { vencimiento: Temporal.PlainDate.from("2026-11-06"), hoy: Temporal.PlainDate.from("2026-11-16") };
    const e = (total: string, acreditado: bigint, pagado: bigint) => rules.estadoCuenta({ total, acreditado, pagado, ...base });
    expect(e("1000.00", 0n, 0n)).toMatchObject({ saldo: "1000.00", estadoPago: "PENDIENTE", diasVencida: 10, antiguedad: "D1_30" });
    expect(e("1000.00", 0n, 40000n)).toMatchObject({ saldo: "600.00", estadoPago: "PARCIAL" });
    expect(e("1000.00", 0n, 100000n)).toMatchObject({ saldo: "0.00", estadoPago: "PAGADA", diasVencida: 0, antiguedad: "AL_DIA" });
    // sobrepago (pagos + nota) no deja saldo negativo
    expect(e("1000.00", 20000n, 100000n)).toMatchObject({ saldo: "0.00", estadoPago: "PAGADA" });
    expect(e("1000.00", 100000n, 0n)).toMatchObject({ saldo: "0.00", estadoPago: "ANULADA" });
  });
});

describe("cartera: getCartera", () => {
  const cargar = () => {
    m("Facturas")["all"]!.mockResolvedValue([
      factura("A", "1000.00", "2026-11-16"), // vence hoy: al dia
      factura("B", "1000.00", "2026-11-10"), // 6 dias, abono 400
      factura("C", "500.00", "2026-10-01"), // 46 dias
      factura("D", "200.00", "2026-09-01"), // 76 dias
      factura("E", "100.00", "2026-01-01"), // mas de 90
      factura("F", "300.00", "2026-10-01"), // pagada completa
      factura("G", "700.00", "2026-10-01"), // anulada por NC
      factura("H", "50.00", null, { fechaEmision: Temporal.Instant.from("2026-11-01T03:00:00Z") }), // sin vencimiento: emision en hora Colombia = 31-oct
    ]);
    m("NotasCredito")["all"]!.mockResolvedValue([
      { facturaId: "G", total: "700.00" },
      { facturaId: "B", total: "100.00" },
    ]);
    m("Pagos")["all"]!.mockResolvedValue([
      { facturaId: "B", monto: "400.00" },
      { facturaId: "F", monto: "100.00" },
      { facturaId: "F", monto: "200.00" },
    ]);
  };

  it("resume por cobrar, vencido y los cinco tramos de antiguedad", async () => {
    cargar();
    const { resumen } = await svc.getCartera({ filtro: "TODAS" });
    // B: 1000 - 100 NC - 400 pagado = 500
    expect(resumen.porAntiguedad).toEqual({ AL_DIA: "1000.00", D1_30: "550.00", D31_60: "500.00", D61_90: "200.00", MAS_90: "100.00" });
    expect(resumen.porCobrar).toBe("2350.00");
    expect(resumen.vencido).toBe("1350.00");
    expect(resumen.facturasConSaldo).toBe(6);
    expect(resumen.facturasVencidas).toBe(5);
  });

  it("filtra CON_SALDO, VENCIDAS y TODAS y ordena las mas vencidas primero", async () => {
    cargar();
    const conSaldo = await svc.getCartera({ filtro: "CON_SALDO" });
    expect(conSaldo.facturas.map((f) => f.id)).toEqual(["E", "D", "C", "H", "B", "A"]);
    cargar();
    const vencidas = await svc.getCartera({ filtro: "VENCIDAS" });
    expect(vencidas.facturas.map((f) => f.id)).toEqual(["E", "D", "C", "H", "B"]);
    cargar();
    const todas = await svc.getCartera({ filtro: "TODAS" });
    expect(todas.facturas).toHaveLength(8);
    const por = Object.fromEntries(todas.facturas.map((f) => [f.id, f]));
    expect(por["F"]).toMatchObject({ estadoPago: "PAGADA", saldo: "0.00" });
    expect(por["G"]).toMatchObject({ estadoPago: "ANULADA", saldo: "0.00" });
    expect(por["B"]).toMatchObject({ estadoPago: "PARCIAL", acreditado: "100.00", pagado: "400.00" });
    expect(por["H"]).toMatchObject({ vencimiento: "2026-10-31", diasVencida: 16 });
    expect(por["A"]).toMatchObject({ diasVencida: 0, antiguedad: "AL_DIA", estadoPago: "PENDIENTE" });
  });

  it("con cartera vacia todo es cero", async () => {
    m("Facturas")["all"]!.mockResolvedValue([]);
    m("NotasCredito")["all"]!.mockResolvedValue([]);
    m("Pagos")["all"]!.mockResolvedValue([]);
    const r = await svc.getCartera({ filtro: "CON_SALDO" });
    expect(r.facturas).toEqual([]);
    expect(r.resumen).toMatchObject({ porCobrar: "0.00", vencido: "0.00", facturasConSaldo: 0, facturasVencidas: 0 });
  });
});

describe("cartera: estado de cuenta y pagos", () => {
  const cuenta = (opts: { notas?: unknown[]; pagos?: unknown[]; total?: string } = {}) => {
    T.getFacturaById.mockResolvedValue(factura(FACT, opts.total ?? "1000.00", "2026-11-26"));
    m("Pagos")["all"]!.mockResolvedValue(opts.pagos ?? []);
    m("NotasCredito")["all"]!.mockResolvedValue(opts.notas ?? []);
  };

  it("solo las notas VALIDADAS reducen el saldo", async () => {
    cuenta({
      notas: [
        { id: "n1", numero: "NC1", tipoAjuste: "PARCIAL", total: "100.00", estadoDian: "VALIDADA" },
        { id: "n2", numero: "NC2", tipoAjuste: "PARCIAL", total: "300.00", estadoDian: "RECHAZADA" },
      ],
      pagos: [{ monto: "250.50" }],
    });
    const r = await svc.getEstadoCuentaFactura(FACT);
    expect(r).toMatchObject({ acreditado: "100.00", pagado: "250.50", saldo: "649.50", estadoPago: "PARCIAL", diasVencida: 0, vencimiento: "2026-11-26" });
    expect(r.notasCredito).toHaveLength(2);
  });

  it("registra un pago parcial y devuelve el estado actualizado", async () => {
    cuenta();
    const r = await svc.registrarPago(FACT, { monto: 400, metodoPago: "EFECTIVO", referencia: " R1", observaciones: "abono" }, "u1");
    expect(m("Facturas")["update"]).toHaveBeenCalledWith({ updatedAt: expect.anything() });
    const creado = m("Pagos")["create"]!.mock.calls[0]![0];
    expect(creado).toMatchObject({ facturaId: FACT, registradoPor: "u1", monto: "400.00", metodoPago: "EFECTIVO", referencia: " R1", observaciones: "abono" });
    expect(creado.fechaPago.toString()).toBe("2026-11-16T17:00:00Z");
    expect(r.facturaId).toBe(FACT);
  });

  it("acepta pagar exactamente el saldo y decimales como 0.1+0.2", async () => {
    cuenta({ total: "0.30" });
    await svc.registrarPago(FACT, { monto: 0.1 + 0.2, metodoPago: "OTRO" });
    expect(m("Pagos")["create"]).toHaveBeenCalledWith(expect.objectContaining({ monto: "0.30", registradoPor: null, referencia: null, observaciones: null }));
  });

  it("rechaza un sobrepago de un centavo con 400 y no escribe el pago", async () => {
    cuenta({ pagos: [{ monto: "400.00" }] });
    await expect(svc.registrarPago(FACT, { monto: 600.01, metodoPago: "EFECTIVO" })).rejects.toMatchObject({
      statusCode: 400, message: "El pago supera el saldo pendiente (600.00)",
    });
    expect(m("Pagos")["create"]).not.toHaveBeenCalled();
  });

  it("rechaza pagos sobre facturas ya pagadas o anuladas", async () => {
    cuenta({ pagos: [{ monto: "1000.00" }] });
    await expect(svc.registrarPago(FACT, { monto: 0.01, metodoPago: "TARJETA" })).rejects.toMatchObject({ statusCode: 400 });
    cuenta({ notas: [{ id: "n", numero: "NC", tipoAjuste: "TOTAL", total: "1000.00", estadoDian: "VALIDADA" }] });
    await expect(svc.registrarPago(FACT, { monto: 1, metodoPago: "TARJETA" })).rejects.toThrow(/anulada/);
    expect(m("Pagos")["create"]).not.toHaveBeenCalled();
  });

  it("fecha de pago futura es 400; una fecha pasada se guarda al mediodia de Colombia", async () => {
    cuenta();
    await expect(svc.registrarPago(FACT, { monto: 10, metodoPago: "EFECTIVO", fechaPago: "2026-11-17" })).rejects.toThrow(/futura/);
    expect(m("Pagos")["create"]).not.toHaveBeenCalled();
    await svc.registrarPago(FACT, { monto: 10, metodoPago: "EFECTIVO", fechaPago: "2026-11-10" });
    expect(m("Pagos")["create"]!.mock.calls[0]![0].fechaPago.toString()).toBe("2026-11-10T17:00:00Z");
    await svc.registrarPago(FACT, { monto: 10, metodoPago: "EFECTIVO", fechaPago: "2026-11-16" });
    expect(m("Pagos")["create"]!.mock.calls[1]![0].fechaPago.toString()).toBe("2026-11-16T17:00:00Z");
  });
});

describe("cartera: controlador", () => {
  const llamar = async (h: unknown, req: Record<string, unknown>) => {
    const r: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const k of ["json", "status"]) r[k] = vi.fn(() => r);
    const next = vi.fn();
    (h as (a: unknown, b: unknown, c: unknown) => void)(req, r, next);
    await vi.waitFor(() => expect(r["json"]!.mock.calls.length + next.mock.calls.length).toBeGreaterThan(0));
    return { r, next };
  };

  it("lista con filtro por defecto CON_SALDO", async () => {
    m("Facturas")["all"]!.mockResolvedValue([factura("A", "10.00", "2026-11-01")]);
    m("NotasCredito")["all"]!.mockResolvedValue([]);
    m("Pagos")["all"]!.mockResolvedValue([]);
    const { r } = await llamar(ctl.getCarteraController, { query: {} });
    expect(r["json"]).toHaveBeenCalledWith({ data: expect.objectContaining({ facturas: [expect.objectContaining({ id: "A" })] }) });
  });

  it("estado de cuenta y registro de pago (201)", async () => {
    T.getFacturaById.mockResolvedValue(factura(FACT, "100.00", "2026-11-26"));
    m("Pagos")["all"]!.mockResolvedValue([]);
    m("NotasCredito")["all"]!.mockResolvedValue([]);
    let x = await llamar(ctl.getEstadoCuentaController, { params: { id: FACT } });
    expect(x.r["json"]).toHaveBeenCalledWith({ data: expect.objectContaining({ saldo: "100.00" }) });
    x = await llamar(ctl.registrarPagoController, { params: { id: FACT }, body: { monto: 100, metodoPago: "EFECTIVO" }, user: { id: "u1" } });
    expect(x.r["status"]).toHaveBeenCalledWith(201);
    expect(m("Pagos")["create"]).toHaveBeenCalledWith(expect.objectContaining({ registradoPor: "u1" }));
  });

  it("un sobrepago llega a next como 400", async () => {
    T.getFacturaById.mockResolvedValue(factura(FACT, "100.00", "2026-11-26"));
    m("Pagos")["all"]!.mockResolvedValue([]);
    m("NotasCredito")["all"]!.mockResolvedValue([]);
    const { next } = await llamar(ctl.registrarPagoController, { params: { id: FACT }, body: { monto: 100.01, metodoPago: "EFECTIVO" } });
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});
