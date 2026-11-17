import "temporal-polyfill/global";

import { db } from "../../prisma/db.js";
import { notFound } from "../../shared/http-error.js";
import { nullableVarchar, numeric, varchar } from "../../shared/prisma-types.js";
import { hoyColombia, nowInstant } from "../../shared/time.js";
import type { CreateSesionInput, UpdateHallazgoInput } from "./usabilidad.schemas.js";
import {
  calcularResumen,
  calcularSus,
  generarInforme,
  interpretarSus,
  parseRespuestasSus,
  type Prioridad,
  type SesionResumen,
} from "./usabilidad.rules.js";

const sesionesConDetalle = () =>
  db.orm.public.UsabilidadSesiones.include("tareas", (t) => t.orderBy((x) => x.createdAt.asc())).include(
    "hallazgos",
    (h) => h.orderBy((x) => x.createdAt.asc()),
  );

type SesionDb = Awaited<ReturnType<ReturnType<typeof sesionesConDetalle>["all"]>>[number];

const presentarSesion = (sesion: SesionDb) => {
  const susPuntaje = Number(sesion.susPuntaje);

  return {
    id: sesion.id,
    participante: sesion.participante,
    perfil: sesion.perfil,
    fechaSesion: sesion.fechaSesion.toString(),
    observaciones: sesion.observaciones,
    susRespuestas: parseRespuestasSus(sesion.susRespuestas),
    susPuntaje,
    susNivel: interpretarSus(susPuntaje),
    tareas: sesion.tareas,
    hallazgos: sesion.hallazgos.map((h) => ({ ...h, prioridad: h.prioridad as Prioridad })),
    createdAt: sesion.createdAt,
  };
};

type SesionPresentada = ReturnType<typeof presentarSesion>;

const aResumen = (sesion: SesionPresentada): SesionResumen => ({
  participante: sesion.participante,
  perfil: sesion.perfil,
  fechaSesion: sesion.fechaSesion,
  observaciones: sesion.observaciones,
  susPuntaje: sesion.susPuntaje,
  tareas: sesion.tareas.map((t) => ({ tarea: t.tarea, completada: t.completada, errores: t.errores })),
  hallazgos: sesion.hallazgos.map((h) => ({
    descripcion: h.descripcion,
    pantalla: h.pantalla,
    prioridad: h.prioridad,
    enBacklog: h.enBacklog,
    resuelto: h.resuelto,
  })),
});

export const listSesiones = async () => {
  const sesiones = (await sesionesConDetalle().all()).map(presentarSesion);
  return sesiones.sort((a, b) => b.fechaSesion.localeCompare(a.fechaSesion));
};

export const getSesionById = async (id: string) => {
  const sesion = await sesionesConDetalle().where({ id }).first();

  if (!sesion) {
    throw notFound("Sesion de usabilidad no encontrada");
  }

  return presentarSesion(sesion);
};

export const createSesion = async (input: CreateSesionInput, creadaPor?: string) => {
  const puntaje = calcularSus(input.susRespuestas);
  const fechaSesion = input.fechaSesion ?? hoyColombia();

  const id = await db.transaction(async (tx) => {
    const sesion = await tx.orm.public.UsabilidadSesiones.create({
      participante: varchar<150>(input.participante),
      perfil: nullableVarchar<200>(input.perfil) ?? null,
      fechaSesion: Temporal.PlainDate.from(fechaSesion),
      observaciones: input.observaciones ?? null,
      susRespuestas: JSON.stringify(input.susRespuestas),
      susPuntaje: numeric<5, 2>(puntaje.toFixed(2)),
      creadaPor: creadaPor ?? null,
    });

    await tx.orm.public.UsabilidadTareas.createAll(
      input.tareas.map((t) => ({
        sesionId: sesion.id,
        tarea: varchar<250>(t.tarea),
        completada: t.completada,
        errores: t.errores,
        observaciones: t.observaciones ?? null,
      })),
    );

    if (input.hallazgos.length > 0) {
      await tx.orm.public.UsabilidadHallazgos.createAll(
        input.hallazgos.map((h) => ({
          sesionId: sesion.id,
          descripcion: h.descripcion,
          pantalla: nullableVarchar<100>(h.pantalla) ?? null,
          prioridad: varchar<10>(h.prioridad),
          // Las mejoras criticas entran al backlog desde el registro (criterio de HU-14).
          enBacklog: h.prioridad === "CRITICA",
        })),
      );
    }

    return sesion.id;
  });

  return getSesionById(id);
};

export const deleteSesion = async (id: string) => {
  await getSesionById(id);
  // tareas y hallazgos se borran en cascada.
  await db.orm.public.UsabilidadSesiones.where({ id }).delete();
};

export const updateHallazgo = async (id: string, input: UpdateHallazgoInput) => {
  const hallazgo = await db.orm.public.UsabilidadHallazgos.where({ id }).first();

  if (!hallazgo) {
    throw notFound("Hallazgo no encontrado");
  }

  await db.orm.public.UsabilidadHallazgos.where({ id }).update({ ...input, updatedAt: nowInstant() });
  return getSesionById(hallazgo.sesionId);
};

export const getResumen = async () => calcularResumen((await listSesiones()).map(aResumen));

export const getInformeMarkdown = async () => {
  const sesiones = (await listSesiones()).map(aResumen).sort((a, b) => a.fechaSesion.localeCompare(b.fechaSesion));
  return generarInforme(sesiones, hoyColombia());
};
