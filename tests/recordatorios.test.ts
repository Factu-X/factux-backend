import "temporal-polyfill/global";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { evaluarVencimiento, textoCorreo } from "../src/modules/recordatorios/recordatorios.rules.js";
import { cambiarEstadoSchema, createRecordatorioSchema } from "../src/modules/recordatorios/recordatorios.schemas.js";

const ID = "550e8400-e29b-41d4-a716-446655440000";

describe("recordatorios: vencimiento", () => {
  const base = { estado: "PENDIENTE" as const, fechaObjetivo: null, kilometrajeObjetivo: null, kilometrajeActual: null, hoy: "2026-11-13" };

  it("vence cuando la fecha ya llego o paso, pero no antes", () => {
    expect(evaluarVencimiento({ ...base, fechaObjetivo: "2026-11-13" }).vencidoPorFecha).toBe(true);
    expect(evaluarVencimiento({ ...base, fechaObjetivo: "2026-01-01" }).vencido).toBe(true);
    expect(evaluarVencimiento({ ...base, fechaObjetivo: "2026-11-14" }).vencido).toBe(false);
  });

  it("vence por kilometraje solo si la moto ya lo alcanzo", () => {
    expect(evaluarVencimiento({ ...base, kilometrajeObjetivo: 5000, kilometrajeActual: 5000 }).vencidoPorKm).toBe(true);
    expect(evaluarVencimiento({ ...base, kilometrajeObjetivo: 5000, kilometrajeActual: 4999 }).vencido).toBe(false);
    expect(evaluarVencimiento({ ...base, kilometrajeObjetivo: 5000, kilometrajeActual: null }).vencido).toBe(false);
  });

  it("un recordatorio completado o cancelado nunca esta vencido", () => {
    for (const estado of ["COMPLETADO", "CANCELADO"] as const) {
      expect(evaluarVencimiento({ ...base, estado, fechaObjetivo: "2020-01-01" }).vencido).toBe(false);
    }
  });
});

describe("recordatorios: validacion", () => {
  const valido = { motocicletaId: ID, tipoMantenimiento: "Cambio de aceite" };

  it("exige fecha, kilometraje o ambos", () => {
    expect(createRecordatorioSchema.safeParse(valido).success).toBe(false);
    expect(createRecordatorioSchema.safeParse({ ...valido, fechaObjetivo: "2026-12-01" }).success).toBe(true);
    expect(createRecordatorioSchema.safeParse({ ...valido, kilometrajeObjetivo: 0 }).success).toBe(true);
    expect(createRecordatorioSchema.safeParse({ ...valido, fechaObjetivo: "2026-12-01", kilometrajeObjetivo: 9000 }).success).toBe(true);
  });

  it("rechaza fechas mal formadas y kilometrajes negativos", () => {
    expect(createRecordatorioSchema.safeParse({ ...valido, fechaObjetivo: "01/12/2026" }).success).toBe(false);
    expect(createRecordatorioSchema.safeParse({ ...valido, kilometrajeObjetivo: -1 }).success).toBe(false);
  });

  it("el siguiente recordatorio solo aplica al completar y tambien necesita objetivo", () => {
    expect(cambiarEstadoSchema.safeParse({ estado: "COMPLETADO", siguiente: { kilometrajeObjetivo: 8000 } }).success).toBe(true);
    expect(cambiarEstadoSchema.safeParse({ estado: "COMPLETADO", siguiente: {} }).success).toBe(false);
    expect(cambiarEstadoSchema.safeParse({ estado: "CANCELADO", siguiente: { kilometrajeObjetivo: 8000 } }).success).toBe(false);
  });
});

describe("recordatorios: correo", () => {
  it("menciona la placa, el servicio y cuando toca", () => {
    const texto = textoCorreo({
      cliente: "Ana", taller: "Moto Taller", placa: "ABC12D", tipoMantenimiento: "Cambio de aceite",
      fechaObjetivo: "2026-12-01", kilometrajeObjetivo: null,
    });
    expect(texto).toContain("ABC12D");
    expect(texto).toContain("Cambio de aceite");
    expect(texto).toContain("2026-12-01");
  });
});

// Servicio con la base y el correo simulados: se prueba que no haya avisos duplicados ni errores por falta de correo.
const mocks = vi.hoisted(() => ({
  all: vi.fn(),
  update: vi.fn(),
  empresa: vi.fn(),
  enviar: vi.fn(),
  configurado: vi.fn(),
}));

vi.mock("../src/prisma/db.js", () => ({
  db: {
    orm: {
      public: {
        RecordatoriosMantenimiento: {
          include: () => ({ all: mocks.all }),
          where: () => ({ update: mocks.update }),
        },
        ConfiguracionEmpresa: { where: () => ({ first: mocks.empresa }) },
      },
    },
  },
}));
vi.mock("../src/shared/email.js", () => ({ correoConfigurado: mocks.configurado, enviarCorreo: mocks.enviar }));
vi.mock("../src/modules/motocicletas/motocicletas.service.js", () => ({ getMotocicletaById: vi.fn() }));

const { notificarVencidos } = await import("../src/modules/recordatorios/recordatorios.service.js");

const recordatorio = (id: string, extra: Record<string, unknown> = {}, email: string | null = "cliente@correo.co") => ({
  id,
  estado: "PENDIENTE",
  motocicletaId: ID,
  tipoMantenimiento: "Cambio de aceite",
  fechaObjetivo: Temporal.PlainDate.from("2020-01-01"),
  kilometrajeObjetivo: null,
  notificacionEnviadaAt: null,
  motocicleta: { placa: "ABC12D", kilometrajeActual: 100, cliente: { nombreRazonSocial: "Ana", email } },
  ...extra,
});

describe("recordatorios: notificarVencidos", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.configurado.mockReturnValue(true);
    mocks.empresa.mockResolvedValue({ nombreComercial: "Moto Taller", razonSocial: "Moto Taller SAS" });
    mocks.enviar.mockResolvedValue(undefined);
    mocks.update.mockResolvedValue(undefined);
  });

  it("avisa solo a los vencidos que no se habian notificado y los marca para no repetir", async () => {
    mocks.all.mockResolvedValue([
      recordatorio("a"),
      recordatorio("ya-avisado", { notificacionEnviadaAt: Temporal.Now.instant() }),
      recordatorio("futuro", { fechaObjetivo: Temporal.PlainDate.from("2999-01-01") }),
      recordatorio("completado", { estado: "COMPLETADO" }),
    ]);

    expect(await notificarVencidos()).toEqual({ revisados: 1, enviados: 1, sinCorreo: 0, fallidos: 0 });
    expect(mocks.enviar).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("deja pendiente, sin error, al cliente sin correo", async () => {
    mocks.all.mockResolvedValue([recordatorio("a", {}, null)]);

    expect(await notificarVencidos()).toEqual({ revisados: 1, enviados: 0, sinCorreo: 1, fallidos: 0 });
    expect(mocks.enviar).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("si el proveedor falla no marca el aviso como enviado y sigue con los demas", async () => {
    mocks.all.mockResolvedValue([recordatorio("a"), recordatorio("b")]);
    mocks.enviar.mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce(undefined);

    expect(await notificarVencidos()).toEqual({ revisados: 2, enviados: 1, sinCorreo: 0, fallidos: 1 });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("responde 503 si el correo no esta configurado", async () => {
    mocks.configurado.mockReturnValue(false);
    await expect(notificarVencidos()).rejects.toMatchObject({ statusCode: 503 });
  });
});
