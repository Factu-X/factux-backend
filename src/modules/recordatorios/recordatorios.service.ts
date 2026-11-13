import "temporal-polyfill/global";

import { db } from "../../prisma/db.js";
import { isForeignKeyError } from "../../shared/db-errors.js";
import { correoConfigurado, enviarCorreo } from "../../shared/email.js";
import { badRequest, conflict, notFound, serviceUnavailable } from "../../shared/http-error.js";
import { varchar } from "../../shared/prisma-types.js";
import { hoyColombia, nowInstant } from "../../shared/time.js";
import { getMotocicletaById } from "../motocicletas/motocicletas.service.js";
import { asuntoCorreo, evaluarVencimiento, textoCorreo } from "./recordatorios.rules.js";
import type { CambiarEstadoInput, CreateRecordatorioInput, RecordatoriosQuery } from "./recordatorios.schemas.js";

const recordatoriosConMoto = () =>
  db.orm.public.RecordatoriosMantenimiento.include("motocicleta", (moto) => moto.include("cliente"));

type RecordatorioConMoto = Awaited<ReturnType<ReturnType<typeof recordatoriosConMoto>["all"]>>[number];

const conVencimiento = (recordatorio: RecordatorioConMoto, hoy: string) => ({
  ...recordatorio,
  ...evaluarVencimiento({
    estado: recordatorio.estado,
    fechaObjetivo: recordatorio.fechaObjetivo?.toString() ?? null,
    kilometrajeObjetivo: recordatorio.kilometrajeObjetivo,
    kilometrajeActual: recordatorio.motocicleta?.kilometrajeActual ?? null,
    hoy,
  }),
});

const PRIORIDAD_ESTADO = { PENDIENTE: 0, COMPLETADO: 1, CANCELADO: 2 } as const;

export const listRecordatorios = async (query: RecordatoriosQuery) => {
  const hoy = hoyColombia();
  const todos = (await recordatoriosConMoto().all()).map((recordatorio) => conVencimiento(recordatorio, hoy));

  return todos
    .filter((r) => !query.estado || r.estado === query.estado)
    .filter((r) => !query.motocicletaId || r.motocicletaId === query.motocicletaId)
    .filter((r) => query.vencidos === undefined || r.vencido === query.vencidos)
    .sort(
      (a, b) =>
        Number(b.vencido) - Number(a.vencido) ||
        PRIORIDAD_ESTADO[a.estado] - PRIORIDAD_ESTADO[b.estado] ||
        (a.fechaObjetivo?.toString() ?? "9999-12-31").localeCompare(b.fechaObjetivo?.toString() ?? "9999-12-31"),
    );
};

export const getRecordatorioById = async (id: string) => {
  const recordatorio = await recordatoriosConMoto().where({ id }).first();

  if (!recordatorio) {
    throw notFound("Recordatorio no encontrado");
  }

  return conVencimiento(recordatorio, hoyColombia());
};

const datosNuevoRecordatorio = (
  input: Pick<CreateRecordatorioInput, "tipoMantenimiento" | "descripcion" | "fechaObjetivo" | "kilometrajeObjetivo">,
) => ({
  tipoMantenimiento: varchar<200>(input.tipoMantenimiento),
  descripcion: input.descripcion ?? null,
  fechaObjetivo: input.fechaObjetivo ? Temporal.PlainDate.from(input.fechaObjetivo) : null,
  kilometrajeObjetivo: input.kilometrajeObjetivo ?? null,
});

export const createRecordatorio = async (input: CreateRecordatorioInput, creadoPor?: string) => {
  await getMotocicletaById(input.motocicletaId);

  try {
    const creado = await db.orm.public.RecordatoriosMantenimiento.create({
      ...datosNuevoRecordatorio(input),
      motocicletaId: input.motocicletaId,
      ordenOrigenId: input.ordenOrigenId ?? null,
      creadoPor: creadoPor ?? null,
    });

    return await getRecordatorioById(creado.id);
  } catch (error) {
    if (isForeignKeyError(error)) {
      throw notFound("La orden de origen no existe");
    }

    throw error;
  }
};

export const cambiarEstadoRecordatorio = async (id: string, input: CambiarEstadoInput, usuarioId?: string) => {
  const actual = await getRecordatorioById(id);
  const ahora = nowInstant();

  await db.transaction(async (tx) => {
    await tx.orm.public.RecordatoriosMantenimiento.where({ id }).update({
      estado: input.estado,
      // Completar fija la fecha; volver a pendiente o cancelar la limpia.
      completadoAt: input.estado === "COMPLETADO" ? ahora : null,
      updatedAt: ahora,
    });

    // El historial se conserva: el siguiente servicio es un recordatorio nuevo, no una edicion del anterior.
    if (input.siguiente) {
      await tx.orm.public.RecordatoriosMantenimiento.create({
        ...datosNuevoRecordatorio({
          ...input.siguiente,
          tipoMantenimiento: input.siguiente.tipoMantenimiento ?? actual.tipoMantenimiento,
        }),
        motocicletaId: actual.motocicletaId,
        ordenOrigenId: actual.ordenOrigenId,
        creadoPor: usuarioId ?? null,
      });
    }
  });

  return getRecordatorioById(id);
};

type ResultadoNotificacion = "ENVIADO" | "SIN_CORREO";

const nombreTaller = async () => {
  const empresa = await db.orm.public.ConfiguracionEmpresa.where({ singleton: true }).first();
  return empresa?.nombreComercial ?? empresa?.razonSocial ?? "tu taller";
};

const exigirCorreoConfigurado = () => {
  if (!correoConfigurado()) {
    throw serviceUnavailable("El envio de correo no esta configurado (faltan RESEND_API_KEY y EMAIL_FROM)");
  }
};

// Envia el aviso y solo entonces marca notificacionEnviadaAt: si el proveedor falla, el recordatorio
// sigue sin notificar y se puede reintentar. Un cliente sin correo no es un error: queda pendiente.
const notificar = async (
  recordatorio: ReturnType<typeof conVencimiento>,
  taller: string,
): Promise<ResultadoNotificacion> => {
  const cliente = recordatorio.motocicleta?.cliente;
  const correo = cliente?.email?.trim();

  if (!cliente || !correo) {
    return "SIN_CORREO";
  }

  await enviarCorreo({
    para: correo,
    asunto: asuntoCorreo(taller),
    texto: textoCorreo({
      cliente: cliente.nombreRazonSocial,
      taller,
      placa: recordatorio.motocicleta?.placa ?? "",
      tipoMantenimiento: recordatorio.tipoMantenimiento,
      fechaObjetivo: recordatorio.fechaObjetivo?.toString() ?? null,
      kilometrajeObjetivo: recordatorio.kilometrajeObjetivo,
    }),
  });

  const ahora = nowInstant();
  await db.orm.public.RecordatoriosMantenimiento
    .where({ id: recordatorio.id })
    .update({ notificacionEnviadaAt: ahora, updatedAt: ahora });

  return "ENVIADO";
};

// Evita que dos clics seguidos (o dos usuarios) manden el mismo aviso dos veces mientras corre un envio.
let enCurso = false;

export const notificarRecordatorio = async (id: string) => {
  exigirCorreoConfigurado();

  const recordatorio = await getRecordatorioById(id);

  if (recordatorio.estado !== "PENDIENTE") {
    throw badRequest("Solo se notifican recordatorios pendientes");
  }

  if (recordatorio.notificacionEnviadaAt) {
    throw conflict("Este recordatorio ya fue notificado al cliente");
  }

  if (enCurso) {
    throw conflict("Ya hay un envio de notificaciones en curso");
  }

  enCurso = true;

  try {
    return { resultado: await notificar(recordatorio, await nombreTaller()) };
  } finally {
    enCurso = false;
  }
};

export const notificarVencidos = async () => {
  exigirCorreoConfigurado();

  if (enCurso) {
    throw conflict("Ya hay un envio de notificaciones en curso");
  }

  enCurso = true;

  try {
    const taller = await nombreTaller();
    const hoy = hoyColombia();
    const candidatos = (await recordatoriosConMoto().all())
      .map((recordatorio) => conVencimiento(recordatorio, hoy))
      .filter((r) => r.vencido && !r.notificacionEnviadaAt);

    const resumen = { revisados: candidatos.length, enviados: 0, sinCorreo: 0, fallidos: 0 };

    for (const recordatorio of candidatos) {
      try {
        const resultado = await notificar(recordatorio, taller);

        if (resultado === "ENVIADO") resumen.enviados += 1;
        else resumen.sinCorreo += 1;
      } catch {
        resumen.fallidos += 1;
      }
    }

    return resumen;
  } finally {
    enCurso = false;
  }
};
