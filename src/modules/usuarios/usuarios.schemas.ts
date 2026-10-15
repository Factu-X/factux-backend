import { z } from "zod";

export const rolUsuarioSchema = z.enum(["ADMINISTRADOR", "FACTURACION", "OPERADOR"]);

export const usuarioIdParamsSchema = z.object({
  id: z.uuid(),
});

export const createUsuarioSchema = z
  .object({
    nombre: z.string().trim().min(2).max(150),
    email: z.email().max(200),
    password: z.string().min(8).max(72),
    rol: rolUsuarioSchema,
  })
  .strict();

export const updateUsuarioSchema = z
  .object({
    nombre: z.string().trim().min(2).max(150).optional(),
    email: z.email().max(200).optional(),
    rol: rolUsuarioSchema.optional(),
    activo: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export type UsuarioIdParams = z.infer<typeof usuarioIdParamsSchema>;
export type CreateUsuarioInput = z.infer<typeof createUsuarioSchema>;
export type UpdateUsuarioInput = z.infer<typeof updateUsuarioSchema>;
