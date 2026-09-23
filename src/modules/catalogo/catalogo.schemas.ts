import { z } from "zod";

export const tipoItemCatalogoSchema = z.enum(["SERVICIO", "REPUESTO"]);
export const tratamientoIvaSchema = z.enum(["GRAVADO", "EXENTO", "EXCLUIDO"]);

export const catalogoIdParamsSchema = z.object({
  id: z.uuid(),
});

export const catalogoQuerySchema = z.object({
  tipo: tipoItemCatalogoSchema.optional(),
  activo: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  search: z.string().trim().min(1).optional(),
});

const catalogoItemBaseSchema = z
  .object({
    codigo: z.string().trim().min(1).max(50).transform((value) => value.toUpperCase()),
    nombre: z.string().trim().min(2).max(200),
    descripcion: z.string().trim().nullable().optional(),
    tipo: tipoItemCatalogoSchema,
    precioVenta: z.number().nonnegative(),
    tratamientoIva: tratamientoIvaSchema.default("GRAVADO"),
    tarifaIva: z.number().min(0).max(100).default(19),
    activo: z.boolean().optional(),
  })
  .strict();

export const createCatalogoItemSchema = catalogoItemBaseSchema
  .refine(
    (value) => value.tratamientoIva === "GRAVADO" || value.tarifaIva === 0,
    "Los items EXENTO o EXCLUIDO deben tener tarifaIva 0",
  );

export const updateCatalogoItemSchema = catalogoItemBaseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  })
  .refine(
    (value) =>
      value.tratamientoIva === undefined ||
      value.tratamientoIva === "GRAVADO" ||
      value.tarifaIva === 0,
    "Los items EXENTO o EXCLUIDO deben tener tarifaIva 0",
  );

export type CatalogoIdParams = z.infer<typeof catalogoIdParamsSchema>;
export type CatalogoQuery = z.infer<typeof catalogoQuerySchema>;
export type CreateCatalogoItemInput = z.infer<typeof createCatalogoItemSchema>;
export type UpdateCatalogoItemInput = z.infer<typeof updateCatalogoItemSchema>;
