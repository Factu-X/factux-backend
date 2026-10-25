import { z } from "zod";

export const tipoItemCatalogoSchema = z.enum(["SERVICIO", "REPUESTO"]);
export const tratamientoIvaSchema = z.enum(["GRAVADO", "EXENTO", "EXCLUIDO"]);

// Tarifas de IVA vigentes (E.T. art. 468 general 19%, arts. 468-1 y 468-3 diferencial 5%).
// Exentos y excluidos van en 0%: el exento se reporta a la DIAN con tarifa 0, el excluido no causa IVA.
export const TARIFAS_IVA_GRAVADO = [19, 5];
const TARIFA_INVALIDA = "Un item GRAVADO solo admite tarifa de IVA 19% o 5%";

const tarifaValida = (value: { tratamientoIva?: string; tarifaIva?: number }) =>
  value.tarifaIva === undefined ||
  value.tratamientoIva !== "GRAVADO" ||
  TARIFAS_IVA_GRAVADO.includes(value.tarifaIva);

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
  )
  .refine(tarifaValida, TARIFA_INVALIDA);

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
  )
  .refine(tarifaValida, TARIFA_INVALIDA);

export type CatalogoIdParams = z.infer<typeof catalogoIdParamsSchema>;
export type CatalogoQuery = z.infer<typeof catalogoQuerySchema>;
export type CreateCatalogoItemInput = z.infer<typeof createCatalogoItemSchema>;
export type UpdateCatalogoItemInput = z.infer<typeof updateCatalogoItemSchema>;
