import { z } from "zod";

export const reporteFacturacionQuerySchema = z.object({
  desde: z.iso.date("Debe ser una fecha YYYY-MM-DD").optional(),
  hasta: z.iso.date("Debe ser una fecha YYYY-MM-DD").optional(),
});

export type ReporteFacturacionQuery = z.infer<typeof reporteFacturacionQuerySchema>;
