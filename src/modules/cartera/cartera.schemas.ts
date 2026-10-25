import { z } from "zod";

export const carteraQuerySchema = z.object({
  filtro: z.enum(["CON_SALDO", "VENCIDAS", "TODAS"]).default("CON_SALDO"),
});

export const registrarPagoSchema = z
  .object({
    monto: z.number().positive("El monto debe ser mayor que cero").max(1_000_000_000),
    metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA", "OTRO"]),
    referencia: z.string().trim().max(150).nullable().optional(),
    observaciones: z.string().trim().max(500).nullable().optional(),
    fechaPago: z.iso.date("Debe ser una fecha YYYY-MM-DD").optional(),
  })
  .strict()
  .refine((value) => Math.abs(value.monto * 100 - Math.round(value.monto * 100)) < 1e-6, {
    message: "El monto admite maximo 2 decimales",
    path: ["monto"],
  });

export type CarteraQuery = z.infer<typeof carteraQuerySchema>;
export type RegistrarPagoInput = z.infer<typeof registrarPagoSchema>;
