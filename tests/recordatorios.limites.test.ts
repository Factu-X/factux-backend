import "temporal-polyfill/global";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { transicionPermitida } from "../src/modules/recordatorios/recordatorios.rules.js";

// Casos limite de HU-11 con la base y el correo simulados.
const MOTO = "550e8400-e29b-41d4-a716-446655440000";
const OTRA_MOTO = "550e8400-e29b-41d4-a716-446655440001";
const ORDEN = "550e8400-e29b-41d4-a716-446655440002";

const mocks = vi.hoisted(() => ({
  first: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  orden: vi.fn(),
  moto: vi.fn(),
  empresa: vi.fn(),
  enviar: vi.fn(),
  configurado: vi.fn(),
}));

vi.mock("../src/prisma/db.js", () => {
  const db = {
    orm: {
      public: {
        RecordatoriosMantenimiento: {
          include: () => ({ where: () => ({ first: mocks.first }), all: vi.fn() }),
          where: (filtro: unknown) => ({ update: (datos: unknown) => mocks.update(filtro, datos) }),
          create: mocks.create,
        },
        OrdenesServicio: { where: () => ({ first: mocks.orden }) },
        ConfiguracionEmpresa: { where: () => ({ first: mocks.empresa }) },
      },
    },
    transaction: (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db };
});
vi.mock("../src/shared/email.js", () => ({ correoConfigurado: mocks.configurado, enviarCorreo: mocks.enviar }));
vi.mock("../src/modules/motocicletas/motocicletas.service.js", () => ({ getMotocicletaById: mocks.moto }));

const { cambiarEstadoRecordatorio, createRecordatorio, notificarRecordatorio } = await import(
  "../src/modules/recordatorios/recordatorios.service.js"
);

const recordatorio = (extra: Record<string, unknown> = {}) => ({
  id: "r1",
  estado: "PENDIENTE",
  motocicletaId: MOTO,
  ordenOrigenId: null,
  tipoMantenimiento: "Cambio de aceite",
  fechaObjetivo: Temporal.PlainDate.from("2020-01-01"),
  kilometrajeObjetivo: null,
  notificacionEnviadaAt: null,
  motocicleta: { placa: "ABC12D", kilometrajeActual: 100, cliente: { nombreRazonSocial: "Ana", email: "ana@correo.co" } },
  ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.configurado.mockReturnValue(true);
  mocks.empresa.mockResolvedValue({ nombreComercial: "Moto Taller" });
  mocks.update.mockResolvedValue({ id: "r1" });
  mocks.create.mockResolvedValue({ id: "r2" });
  mocks.moto.mockResolvedValue({ id: MOTO, activa: true });
});

describe("recordatorios: transiciones de estado", () => {
  it("solo permite completar/cancelar un pendiente y reabrir los cerrados", () => {
    expect(transicionPermitida("PENDIENTE", "COMPLETADO")).toBe(true);
    expect(transicionPermitida("PENDIENTE", "CANCELADO")).toBe(true);
    expect(transicionPermitida("COMPLETADO", "PENDIENTE")).toBe(true);
    expect(transicionPermitida("CANCELADO", "PENDIENTE")).toBe(true);
    expect(transicionPermitida("CANCELADO", "COMPLETADO")).toBe(false);
    expect(transicionPermitida("COMPLETADO", "CANCELADO")).toBe(false);
    for (const estado of ["PENDIENTE", "COMPLETADO", "CANCELADO"] as const) {
      expect(transicionPermitida(estado, estado)).toBe(false);
    }
  });

  it("completar dos veces (doble clic) responde 409 y no duplica el siguiente recordatorio", async () => {
    mocks.first.mockResolvedValue(recordatorio({ estado: "COMPLETADO" }));

    await expect(
      cambiarEstadoRecordatorio("r1", { estado: "COMPLETADO", siguiente: { kilometrajeObjetivo: 8000 } }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("no deja pasar de CANCELADO a COMPLETADO", async () => {
    mocks.first.mockResolvedValue(recordatorio({ estado: "CANCELADO" }));
    await expect(cambiarEstadoRecordatorio("r1", { estado: "COMPLETADO" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("si otra peticion cambio el estado en medio, responde 409 sin crear el siguiente", async () => {
    mocks.first.mockResolvedValue(recordatorio());
    mocks.update.mockResolvedValue(null);

    await expect(
      cambiarEstadoRecordatorio("r1", { estado: "COMPLETADO", siguiente: { kilometrajeObjetivo: 8000 } }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.update.mock.calls[0]?.[0]).toEqual({ id: "r1", estado: "PENDIENTE" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("reabrir limpia el aviso enviado para que se pueda volver a notificar", async () => {
    mocks.first.mockResolvedValue(recordatorio({ estado: "COMPLETADO", notificacionEnviadaAt: Temporal.Now.instant() }));

    await cambiarEstadoRecordatorio("r1", { estado: "PENDIENTE" });
    expect(mocks.update.mock.calls[0]?.[1]).toMatchObject({ estado: "PENDIENTE", notificacionEnviadaAt: null });
  });

  it("completar no toca el aviso enviado", async () => {
    mocks.first.mockResolvedValue(recordatorio());

    await cambiarEstadoRecordatorio("r1", { estado: "COMPLETADO" });
    expect(mocks.update.mock.calls[0]?.[1]).not.toHaveProperty("notificacionEnviadaAt");
  });
});

describe("recordatorios: creacion", () => {
  const input = { motocicletaId: MOTO, tipoMantenimiento: "Cambio de aceite", kilometrajeObjetivo: 9000 };

  it("rechaza una moto inactiva", async () => {
    mocks.moto.mockResolvedValue({ id: MOTO, activa: false });
    await expect(createRecordatorio(input)).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rechaza una orden de origen de otra moto", async () => {
    mocks.orden.mockResolvedValue({ id: ORDEN, motocicletaId: OTRA_MOTO });
    await expect(createRecordatorio({ ...input, ordenOrigenId: ORDEN })).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("responde 404 si la orden de origen no existe", async () => {
    mocks.orden.mockResolvedValue(null);
    await expect(createRecordatorio({ ...input, ordenOrigenId: ORDEN })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("acepta una orden de la misma moto", async () => {
    mocks.orden.mockResolvedValue({ id: ORDEN, motocicletaId: MOTO });
    mocks.first.mockResolvedValue(recordatorio({ id: "r2", ordenOrigenId: ORDEN }));
    await expect(createRecordatorio({ ...input, ordenOrigenId: ORDEN })).resolves.toMatchObject({ id: "r2" });
  });
});

describe("recordatorios: notificacion individual", () => {
  it("marca el aviso antes de enviar, asi un fallo posterior no reenvia el correo", async () => {
    mocks.first.mockResolvedValue(recordatorio());
    const orden: string[] = [];
    mocks.update.mockImplementation(async () => orden.push("marca"));
    mocks.enviar.mockImplementation(async () => orden.push("envia"));

    expect(await notificarRecordatorio("r1")).toEqual({ resultado: "ENVIADO" });
    expect(orden).toEqual(["marca", "envia"]);
  });

  it("si el proveedor falla libera la marca para poder reintentar", async () => {
    mocks.first.mockResolvedValue(recordatorio());
    mocks.enviar.mockRejectedValue(Object.assign(new Error("rechazado"), { statusCode: 503 }));

    await expect(notificarRecordatorio("r1")).rejects.toMatchObject({ statusCode: 503 });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.calls[1]?.[1]).toMatchObject({ notificacionEnviadaAt: null });
  });

  it("dos clics simultaneos solo envian un correo", async () => {
    mocks.first.mockResolvedValue(recordatorio());
    mocks.enviar.mockResolvedValue(undefined);

    const resultados = await Promise.allSettled([notificarRecordatorio("r1"), notificarRecordatorio("r1")]);
    expect(resultados.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(mocks.enviar).toHaveBeenCalledTimes(1);
  });

  it("un recordatorio ya notificado responde 409 y no envia", async () => {
    mocks.first.mockResolvedValue(recordatorio({ notificacionEnviadaAt: Temporal.Now.instant() }));
    await expect(notificarRecordatorio("r1")).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.enviar).not.toHaveBeenCalled();
  });
});
