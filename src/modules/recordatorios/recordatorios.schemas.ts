import { z } from "zod";

import { tieneObjetivo } from "./recordatorios.rules.js";

export const recordatorioIdParamsSchema = z.object({ id: z.uuid() });

const objetivoShape = {
  fechaObjetivo: z.iso.date("Debe ser una fecha YYYY-MM-DD").nullable().optional(),
  kilometrajeObjetivo: z.number().int().nonnegative().max(1_000_000).nullable().optional(),
};

const OBJETIVO_REQUERIDO = {
  message: "Indica la fecha estimada, el kilometraje estimado o ambos",
  path: ["fechaObjetivo"],
};

export const createRecordatorioSchema = z
  .object({
    motocicletaId: z.uuid(),
    ordenOrigenId: z.uuid().nullable().optional(),
    tipoMantenimiento: z.string().trim().min(1, "El tipo de mantenimiento es obligatorio").max(200),
    descripcion: z.string().trim().max(1000).nullable().optional(),
    ...objetivoShape,
  })
  .strict()
  .refine(tieneObjetivo, OBJETIVO_REQUERIDO);

// Al completar un mantenimiento se puede programar el siguiente en el mismo paso.
const siguienteSchema = z
  .object({
    tipoMantenimiento: z.string().trim().min(1).max(200).optional(),
    descripcion: z.string().trim().max(1000).nullable().optional(),
    ...objetivoShape,
  })
  .strict()
  .refine(tieneObjetivo, OBJETIVO_REQUERIDO);

export const cambiarEstadoSchema = z
  .object({
    estado: z.enum(["PENDIENTE", "COMPLETADO", "CANCELADO"]),
    siguiente: siguienteSchema.optional(),
  })
  .strict()
  .refine((valor) => !valor.siguiente || valor.estado === "COMPLETADO", {
    message: "Solo se puede programar el siguiente recordatorio al completar el actual",
    path: ["siguiente"],
  });

export const recordatoriosQuerySchema = z.object({
  estado: z.enum(["PENDIENTE", "COMPLETADO", "CANCELADO"]).optional(),
  motocicletaId: z.uuid().optional(),
  vencidos: z
    .enum(["true", "false"])
    .transform((valor) => valor === "true")
    .optional(),
});

export type RecordatorioIdParams = z.infer<typeof recordatorioIdParamsSchema>;
export type CreateRecordatorioInput = z.infer<typeof createRecordatorioSchema>;
export type CambiarEstadoInput = z.infer<typeof cambiarEstadoSchema>;
export type RecordatoriosQuery = z.infer<typeof recordatoriosQuerySchema>;
