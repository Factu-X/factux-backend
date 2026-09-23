import { z } from "zod";

export const tipoIdentificacionSchema = z.enum(["CC", "CE", "NIT", "PASAPORTE"]);

export const clienteIdParamsSchema = z.object({
  id: z.uuid(),
});

export const clientesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
});

export const createClienteSchema = z
  .object({
    tipoIdentificacion: tipoIdentificacionSchema,
    numeroIdentificacion: z.string().trim().min(3).max(30),
    digitoVerificacion: z.string().trim().length(1).nullable().optional(),
    nombreRazonSocial: z.string().trim().min(2).max(200),
    direccion: z.string().trim().max(250).nullable().optional(),
    telefono: z.string().trim().max(30).nullable().optional(),
    email: z.email().max(200).nullable().optional(),
    activo: z.boolean().optional(),
  })
  .strict();

export const updateClienteSchema = createClienteSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export type ClientesQuery = z.infer<typeof clientesQuerySchema>;
export type ClienteIdParams = z.infer<typeof clienteIdParamsSchema>;
export type CreateClienteInput = z.infer<typeof createClienteSchema>;
export type UpdateClienteInput = z.infer<typeof updateClienteSchema>;
