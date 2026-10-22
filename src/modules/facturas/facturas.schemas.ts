import { z } from "zod";

export const facturaIdParamsSchema = z.object({
  id: z.uuid(),
});

export const facturasQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  estadoDian: z.enum(["PENDIENTE_ENVIO", "ENVIADA", "VALIDADA", "RECHAZADA"]).optional(),
  clienteId: z.uuid().optional(),
  formaPago: z.enum(["CONTADO", "CREDITO"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createFacturaSchema = z
  .object({
    ordenId: z.uuid(),
    formaPago: z.enum(["CONTADO", "CREDITO"]).default("CONTADO"),
    fechaVencimiento: z.string().trim().optional(),
  })
  .strict()
  .refine(
    (value) => value.formaPago === "CONTADO" || !!value.fechaVencimiento,
    "Las facturas a credito requieren fechaVencimiento",
  );

export type FacturasQuery = z.infer<typeof facturasQuerySchema>;
export type FacturaIdParams = z.infer<typeof facturaIdParamsSchema>;
export type CreateFacturaInput = z.infer<typeof createFacturaSchema>;
