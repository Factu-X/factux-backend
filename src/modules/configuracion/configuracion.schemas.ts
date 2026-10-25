import { z } from "zod";

const fecha = z.iso.date("Debe ser una fecha valida YYYY-MM-DD");
const textoOpcional = (max: number) => z.string().trim().max(max).nullable().optional();

export const updateEmpresaSchema = z
  .object({
    nit: z.string().trim().regex(/^\d{5,15}$/, "El NIT debe tener solo digitos, sin DV"),
    digitoVerificacion: z.string().trim().regex(/^\d$/, "El DV es un solo digito"),
    razonSocial: z.string().trim().min(2).max(200),
    nombreComercial: textoOpcional(200),
    tipoPersona: z.enum(["JURIDICA", "NATURAL"]),
    regimenFiscal: textoOpcional(150),
    // Codigos de la lista 48 del Anexo Tecnico separados por ";" (ej. "O-13;O-15" o "R-99-PN").
    responsabilidadesFiscales: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]+(;[A-Z0-9-]+)*$/, "Use codigos separados por ; (ej. O-13;R-99-PN)")
      .max(100),
    direccion: z.string().trim().min(3).max(250),
    ciudad: z.string().trim().min(2).max(100),
    departamento: z.string().trim().min(2).max(100),
    codigoMunicipio: z.string().trim().regex(/^\d{5}$/, "El codigo DANE del municipio tiene 5 digitos"),
    telefono: z.string().trim().min(7).max(30),
    email: z.email().max(200),
  })
  .strict();

export const updateNumeracionSchema = z
  .object({
    ambiente: z.enum(["HABILITACION", "PRODUCCION"]),
    // El prefijo es opcional ("cuando corresponda"); la DIAN admite hasta 4 caracteres alfanumericos.
    prefijoFacturacion: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{1,4}$/, "El prefijo admite hasta 4 letras o numeros")
      .nullable()
      .optional(),
    numeroResolucion: z.string().trim().regex(/^\d{1,100}$/, "El numero de resolucion es numerico"),
    fechaResolucion: fecha,
    rangoDesde: z.number().int().positive(),
    rangoHasta: z.number().int().positive(),
    vigenciaDesde: fecha,
    vigenciaHasta: fecha,
  })
  .strict()
  .refine((value) => value.rangoDesde <= value.rangoHasta, {
    message: "El rango desde no puede ser mayor que el rango hasta",
    path: ["rangoHasta"],
  })
  .refine((value) => value.vigenciaDesde <= value.vigenciaHasta, {
    message: "La vigencia desde no puede ser posterior a la vigencia hasta",
    path: ["vigenciaHasta"],
  });

const secreto = z.string().trim().min(1).max(200);

export const updateCredencialesSchema = z
  .object({
    softwareId: z.string().trim().min(1).max(100).optional(),
    testSetId: z.string().trim().min(1).max(100).nullable().optional(),
    pin: secreto.optional(),
    claveTecnica: secreto.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Debe enviar al menos un campo para actualizar",
  });

export const updateCertificadoSchema = z
  .object({
    archivoBase64: z.base64("El certificado debe enviarse en base64").min(1).max(60_000),
    password: z.string().min(1).max(200),
    expira: fecha,
  })
  .strict();

export type UpdateEmpresaInput = z.infer<typeof updateEmpresaSchema>;
export type UpdateNumeracionInput = z.infer<typeof updateNumeracionSchema>;
export type UpdateCredencialesInput = z.infer<typeof updateCredencialesSchema>;
export type UpdateCertificadoInput = z.infer<typeof updateCertificadoSchema>;
