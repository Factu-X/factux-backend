import { z } from "zod";

import { parseDecimalToScale } from "../../shared/decimal.js";

export const estadoOrdenSchema = z.enum(["ABIERTA", "EN_PROCESO", "FINALIZADA", "CANCELADA"]);

const decimalInputSchema = z.union([
  z.number().finite().nonnegative(),
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => {
      try {
        return parseDecimalToScale(value, 2, "decimal") >= 0n;
      } catch {
        return false;
      }
    }, "Debe ser un decimal no negativo con maximo 2 decimales"),
]);

// HU-03: la BD exige cantidad > 0; se valida aqui para responder 400 y no 500.
const cantidadSchema = decimalInputSchema.refine(
  (value) => Number(value) > 0,
  "La cantidad debe ser mayor a 0",
);

const isoInstantSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Debe ser una fecha ISO valida");

export const ordenIdParamsSchema = z.object({
  id: z.uuid(),
});

export const ordenDetalleIdParamsSchema = z.object({
  id: z.uuid(),
  detalleId: z.uuid(),
});

export const ordenesQuerySchema = z.object({
  estado: estadoOrdenSchema.optional(),
  clienteId: z.uuid().optional(),
  motocicletaId: z.uuid().optional(),
});

export const createOrdenDetalleSchema = z
  .object({
    itemCatalogoId: z.uuid(),
    cantidad: cantidadSchema.default(1),
    precioAplicado: decimalInputSchema.optional(),
  })
  .strict();

export const updateOrdenDetalleSchema = z
  .object({
    cantidad: cantidadSchema.optional(),
    precioAplicado: decimalInputSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export const createOrdenSchema = z
  .object({
    clienteId: z.uuid(),
    motocicletaId: z.uuid(),
    fechaIngreso: isoInstantSchema.optional(),
    kilometrajeIngreso: z.number().int().nonnegative(),
    motivoIngreso: z.string().trim().min(3),
    observaciones: z.string().trim().nullable().optional(),
    estado: z.enum(["ABIERTA", "EN_PROCESO"]).optional(),
    detalles: z.array(createOrdenDetalleSchema).optional(),
  })
  .strict();

export const updateOrdenSchema = z
  .object({
    clienteId: z.uuid().optional(),
    motocicletaId: z.uuid().optional(),
    fechaIngreso: isoInstantSchema.optional(),
    kilometrajeIngreso: z.number().int().nonnegative().optional(),
    motivoIngreso: z.string().trim().min(3).optional(),
    observaciones: z.string().trim().nullable().optional(),
    estado: estadoOrdenSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export type EstadoOrden = z.infer<typeof estadoOrdenSchema>;
export type OrdenesQuery = z.infer<typeof ordenesQuerySchema>;
export type OrdenIdParams = z.infer<typeof ordenIdParamsSchema>;
export type OrdenDetalleIdParams = z.infer<typeof ordenDetalleIdParamsSchema>;
export type CreateOrdenInput = z.infer<typeof createOrdenSchema>;
export type UpdateOrdenInput = z.infer<typeof updateOrdenSchema>;
export type CreateOrdenDetalleInput = z.infer<typeof createOrdenDetalleSchema>;
export type UpdateOrdenDetalleInput = z.infer<typeof updateOrdenDetalleSchema>;
