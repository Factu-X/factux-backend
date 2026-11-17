import "temporal-polyfill/global";

import { db } from "../../prisma/db.js";
import { isForeignKeyError } from "../../shared/db-errors.js";
import { correoConfigurado, enviarCorreo } from "../../shared/email.js";
import { badRequest, conflict, notFound, serviceUnavailable } from "../../shared/http-error.js";
import { varchar } from "../../shared/prisma-types.js";
import { hoyColombia, nowInstant } from "../../shared/time.js";
import { getMotocicletaById } from "../motocicletas/motocicletas.service.js";
import { asuntoCorreo, evaluarVencimiento, textoCorreo, transicionPermitida } from "./recordatorios.rules.js";
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
  const moto = await getMotocicletaById(input.motocicletaId);

  if (!moto.activa) {
    throw badRequest("La motocicleta esta inactiva");
  }

  if (input.ordenOrigenId) {
    const orden = await db.orm.public.OrdenesServicio.where({ id: input.ordenOrigenId }).first();

    if (!orden) {
      throw notFound("La orden de origen no existe");
    }

    if (orden.motocicletaId !== input.motocicletaId) {
      throw badRequest("La orden de origen es de otra motocicleta");
    }
  }

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

  if (!transicionPermitida(actual.estado, input.estado)) {
    throw conflict(`No se puede pasar un recordatorio de ${actual.estado} a ${input.estado}`);
  }

  const ahora = nowInstant();

  await db.transaction(async (tx) => {
    // Filtrar por el estado leido evita que dos peticiones simultaneas apliquen la misma transicion.
    const actualizado = await tx.orm.public.RecordatoriosMantenimiento.where({ id, estado: actual.estado }).update({
      estado: input.estado,
      // Completar fija la fecha; volver a pendiente o cancelar la limpia.
      completadoAt: input.estado === "COMPLETADO" ? ahora : null,
      // Reabrir inicia un ciclo nuevo: el cliente debe poder recibir otro aviso.
      ...(input.estado === "PENDIENTE" ? { notificacionEnviadaAt: null } : {}),
      updatedAt: ahora,
    });

    if (!actualizado) {
      throw conflict("El recordatorio cambio mientras se actualizaba; recarga e intenta de nuevo");
    }

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

// Marca notificacionEnviadaAt antes de enviar y la libera si el proveedor falla: asi un fallo al guardar
// despues del envio no provoca un segundo correo. Un cliente sin correo no es un error: queda pendiente.
const notificar = async (
  recordatorio: ReturnType<typeof conVencimiento>,
  taller: string,
): Promise<ResultadoNotificacion> => {
  const cliente = recordatorio.motocicleta?.cliente;
  const correo = cliente?.email?.trim();

  if (!cliente || !correo) {
    return "SIN_CORREO";
  }

  const marcar = (valor: Temporal.Instant | null) =>
    db.orm.public.RecordatoriosMantenimiento
      .where({ id: recordatorio.id })
      .update({ notificacionEnviadaAt: valor, updatedAt: nowInstant() });

  await marcar(nowInstant());

  try {
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
  } catch (error) {
    await marcar(null);
    throw error;
  }

  return "ENVIADO";
};

// Evita que dos clics seguidos (o dos usuarios) manden el mismo aviso dos veces mientras corre un envio.
// shortcut: candado en memoria, vale para una sola instancia del API; con varias, usar un update condicionado en BD.
let enCurso = false;

export const notificarRecordatorio = async (id: string) => {
  exigirCorreoConfigurado();

  if (enCurso) {
    throw conflict("Ya hay un envio de notificaciones en curso");
  }

  enCurso = true;

  try {
    // Se lee con el candado tomado: otra peticion no puede haber notificado entre la lectura y el envio.
    const recordatorio = await getRecordatorioById(id);

    if (recordatorio.estado !== "PENDIENTE") {
      throw badRequest("Solo se notifican recordatorios pendientes");
    }

    if (recordatorio.notificacionEnviadaAt) {
      throw conflict("Este recordatorio ya fue notificado al cliente");
    }

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
