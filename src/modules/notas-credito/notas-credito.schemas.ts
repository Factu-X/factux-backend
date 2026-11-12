import { z } from "zod";

export const notaCreditoIdParamsSchema = z.object({
  id: z.uuid(),
});

export const notasCreditoQuerySchema = z.object({
  facturaId: z.uuid().optional(),
});

export const createNotaCreditoSchema = z
  .object({
    facturaId: z.uuid(),
    tipoAjuste: z.enum(["TOTAL", "PARCIAL"]),
    motivo: z.string().trim().min(5, "Describe el motivo (minimo 5 caracteres)").max(500),
    lineas: z
      .array(
        z.object({
          detalleFacturaId: z.uuid(),
          cantidad: z.number().positive().max(100000),
        }),
      )
      .optional(),
  })
  .strict()
  .refine((value) => value.tipoAjuste === "TOTAL" || (value.lineas?.length ?? 0) > 0, {
    message: "Una nota parcial requiere al menos una linea",
    path: ["lineas"],
  });

export type NotaCreditoIdParams = z.infer<typeof notaCreditoIdParamsSchema>;
export type NotasCreditoQuery = z.infer<typeof notasCreditoQuerySchema>;
export type CreateNotaCreditoInput = z.infer<typeof createNotaCreditoSchema>;
