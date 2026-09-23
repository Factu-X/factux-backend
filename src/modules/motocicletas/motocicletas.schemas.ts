import { z } from "zod";

export const motocicletaIdParamsSchema = z.object({
  id: z.uuid(),
});

export const clienteMotocicletasParamsSchema = z.object({
  clienteId: z.uuid(),
});

export const createMotocicletaSchema = z
  .object({
    placa: z.string().trim().min(5).max(20).transform((value) => value.toUpperCase()),
    marca: z.string().trim().min(1).max(100),
    modelo: z.string().trim().min(1).max(100),
    anio: z.number().int().min(1900).max(2100).nullable().optional(),
    cilindraje: z.number().int().positive().nullable().optional(),
    kilometrajeActual: z.number().int().nonnegative().nullable().optional(),
    activa: z.boolean().optional(),
  })
  .strict();

export const updateMotocicletaSchema = createMotocicletaSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export type MotocicletaIdParams = z.infer<typeof motocicletaIdParamsSchema>;
export type ClienteMotocicletasParams = z.infer<typeof clienteMotocicletasParamsSchema>;
export type CreateMotocicletaInput = z.infer<typeof createMotocicletaSchema>;
export type UpdateMotocicletaInput = z.infer<typeof updateMotocicletaSchema>;
