import { z } from "zod";

import { calcularDigitoVerificacion } from "../../shared/nit.js";

const fechaSchema = z.iso.date("Debe ser una fecha YYYY-MM-DD");

export const updateEmpresaSchema = z
  .object({
    nit: z.string().trim().regex(/^\d{5,15}$/, "El NIT solo admite digitos, sin DV"),
    digitoVerificacion: z.string().trim().regex(/^\d$/, "El DV es un solo digito"),
    razonSocial: z.string().trim().min(2).max(200),
    direccion: z.string().trim().max(250).nullable().optional(),
    telefono: z.string().trim().max(30).nullable().optional(),
    email: z.email().max(200).nullable().optional(),
    regimenFiscal: z.string().trim().max(150).nullable().optional(),
  })
  .strict()
  .refine((value) => calcularDigitoVerificacion(value.nit) === value.digitoVerificacion, {
    message: "El digito de verificacion no corresponde al NIT",
    path: ["digitoVerificacion"],
  });

export const updateResolucionSchema = z
  .object({
    ambiente: z.enum(["HABILITACION", "PRODUCCION"]),
    prefijoFacturacion: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,4}$/, "El prefijo tiene maximo 4 letras o numeros"),
    numeroResolucion: z.string().trim().min(1).max(100),
    fechaResolucion: fechaSchema,
    rangoDesde: z.number().int().positive(),
    rangoHasta: z.number().int().positive(),
    vigenciaDesde: fechaSchema,
    vigenciaHasta: fechaSchema,
  })
  .strict()
  .refine((value) => value.rangoDesde <= value.rangoHasta, {
    message: "rangoDesde debe ser menor o igual a rangoHasta",
    path: ["rangoHasta"],
  })
  .refine((value) => value.vigenciaDesde <= value.vigenciaHasta, {
    message: "La vigencia debe iniciar antes de terminar",
    path: ["vigenciaHasta"],
  });

export type UpdateEmpresaInput = z.infer<typeof updateEmpresaSchema>;
export type UpdateResolucionInput = z.infer<typeof updateResolucionSchema>;
