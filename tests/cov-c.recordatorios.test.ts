import "temporal-polyfill/global";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const MOTO = "550e8400-e29b-41d4-a716-446655440000";
const OTRA = "550e8400-e29b-41d4-a716-446655440001";

const mocks = vi.hoisted(() => ({ all: vi.fn(), first: vi.fn() }));

vi.mock("../src/prisma/db.js", () => ({
  db: {
    orm: {
      public: {
        RecordatoriosMantenimiento: {
          include: () => ({ where: () => ({ first: mocks.first }), all: mocks.all }),
        },
      },
    },
  },
}));
vi.mock("../src/shared/email.js", () => ({ correoConfigurado: vi.fn(), enviarCorreo: vi.fn() }));
vi.mock("../src/modules/motocicletas/motocicletas.service.js", () => ({ getMotocicletaById: vi.fn() }));

const { listRecordatorios, getRecordatorioById } = await import("../src/modules/recordatorios/recordatorios.service.js");

// Hoy en Colombia: 2026-11-16.
beforeAll(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-16T17:00:00Z") }));
afterAll(() => vi.useRealTimers());

const rec = (id: string, extra: Record<string, unknown> = {}) => ({
  id, estado: "PENDIENTE", motocicletaId: MOTO, kilometrajeObjetivo: null, fechaObjetivo: null,
  motocicleta: { kilometrajeActual: 1000 }, ...extra,
});
const fecha = (s: string) => Temporal.PlainDate.from(s);
const ids = (r: { id: string }[]) => r.map((x) => x.id);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("recordatorios: listado", () => {
  const datos = () => [
    rec("futuro", { fechaObjetivo: fecha("2027-01-01") }),
    rec("hoy", { fechaObjetivo: fecha("2026-11-16") }),
    rec("sin-fecha"),
    rec("completado", { estado: "COMPLETADO", fechaObjetivo: fecha("2020-01-01") }),
    rec("cancelado", { estado: "CANCELADO", fechaObjetivo: fecha("2020-01-01"), motocicletaId: OTRA }),
    rec("por-km", { kilometrajeObjetivo: 900 }),
    rec("viejo", { fechaObjetivo: fecha("2026-01-01") }),
  ];

  it("ordena vencidos primero, luego por estado y por fecha objetivo (sin fecha al final)", async () => {
    mocks.all.mockResolvedValue(datos());
    const r = await listRecordatorios({});
    // vencidos: viejo (fecha 2026-01-01), hoy (2026-11-16), por-km (sin fecha => al final de los vencidos)
    expect(ids(r)).toEqual(["viejo", "hoy", "por-km", "futuro", "sin-fecha", "completado", "cancelado"]);
    expect(r.find((x) => x.id === "hoy")).toMatchObject({ vencido: true, vencidoPorFecha: true, vencidoPorKm: false });
    expect(r.find((x) => x.id === "por-km")).toMatchObject({ vencido: true, vencidoPorKm: true });
    expect(r.find((x) => x.id === "completado")!.vencido).toBe(false);
  });

  it("filtra por estado", async () => {
    mocks.all.mockResolvedValue(datos());
    expect(ids(await listRecordatorios({ estado: "COMPLETADO" }))).toEqual(["completado"]);
    expect(ids(await listRecordatorios({ estado: "CANCELADO" }))).toEqual(["cancelado"]);
  });

  it("filtra por motocicleta", async () => {
    mocks.all.mockResolvedValue(datos());
    expect(ids(await listRecordatorios({ motocicletaId: OTRA }))).toEqual(["cancelado"]);
  });

  it("filtra vencidos true y false (false no excluye al falso por ser falsy)", async () => {
    mocks.all.mockResolvedValue(datos());
    expect(ids(await listRecordatorios({ vencidos: true }))).toEqual(["viejo", "hoy", "por-km"]);
    expect(ids(await listRecordatorios({ vencidos: false }))).toEqual(["futuro", "sin-fecha", "completado", "cancelado"]);
  });

  it("combina filtros y devuelve vacio si nada coincide", async () => {
    mocks.all.mockResolvedValue(datos());
    expect(await listRecordatorios({ estado: "COMPLETADO", vencidos: true })).toEqual([]);
    expect(ids(await listRecordatorios({ estado: "PENDIENTE", motocicletaId: MOTO, vencidos: true }))).toEqual(["viejo", "hoy", "por-km"]);
  });

  it("tolera una moto ausente al evaluar kilometraje", async () => {
    mocks.all.mockResolvedValue([rec("sin-moto", { kilometrajeObjetivo: 10, motocicleta: null })]);
    const [r] = await listRecordatorios({});
    expect(r).toMatchObject({ id: "sin-moto", vencido: false });
  });
});

describe("recordatorios: detalle", () => {
  it("responde 404 si no existe", async () => {
    mocks.first.mockResolvedValue(null);
    await expect(getRecordatorioById("x")).rejects.toMatchObject({ statusCode: 404, message: "Recordatorio no encontrado" });
  });

  it("devuelve el recordatorio con su estado de vencimiento", async () => {
    mocks.first.mockResolvedValue(rec("r1", { fechaObjetivo: fecha("2026-11-15") }));
    expect(await getRecordatorioById("r1")).toMatchObject({ id: "r1", vencido: true, vencidoPorFecha: true });
  });
});
