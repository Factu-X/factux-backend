import { z } from "zod";

import { PRIORIDADES, SUS_PREGUNTAS } from "./usabilidad.rules.js";

export const sesionIdParamsSchema = z.object({ id: z.uuid() });
export const hallazgoIdParamsSchema = z.object({ id: z.uuid() });

export const createSesionSchema = z
  .object({
    participante: z.string().trim().min(1, "El nombre del participante es obligatorio").max(150),
    perfil: z.string().trim().max(200).nullable().optional(),
    fechaSesion: z.iso.date("Debe ser una fecha YYYY-MM-DD").optional(),
    observaciones: z.string().trim().max(4000).nullable().optional(),
    susRespuestas: z
      .array(z.number().int().min(1, "Las respuestas van de 1 a 5").max(5, "Las respuestas van de 1 a 5"))
      .length(SUS_PREGUNTAS, `El cuestionario SUS tiene ${SUS_PREGUNTAS} preguntas`),
    tareas: z
      .array(
        z
          .object({
            tarea: z.string().trim().min(1).max(250),
            completada: z.boolean(),
            errores: z.number().int().min(0).max(100).default(0),
            observaciones: z.string().trim().max(1000).nullable().optional(),
          })
          .strict(),
      )
      .min(1, "Registra al menos una tarea")
      .max(30),
    hallazgos: z
      .array(
        z
          .object({
            descripcion: z.string().trim().min(1).max(2000),
            pantalla: z.string().trim().max(100).nullable().optional(),
            prioridad: z.enum(PRIORIDADES),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict();

export const updateHallazgoSchema = z
  .object({ enBacklog: z.boolean().optional(), resuelto: z.boolean().optional() })
  .strict()
  .refine((valor) => Object.keys(valor).length > 0, { message: "Debe enviar al menos un campo para actualizar" });

export type CreateSesionInput = z.infer<typeof createSesionSchema>;
export type UpdateHallazgoInput = z.infer<typeof updateHallazgoSchema>;
