import "dotenv/config";

import { z } from "zod";

// Una variable vacia en el .env cuenta como no configurada.
const optionalText = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  SUPABASE_URL: z.url("SUPABASE_URL debe ser una URL valida"),
  SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, "SUPABASE_PUBLISHABLE_KEY es obligatoria"),
  // Opcional: solo se necesita para crear usuarios en Supabase Auth desde la API.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // Lista separada por comas. Vacia = cualquier origen (solo desarrollo).
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  // Parametros del software ante la DIAN. Nunca viajan al frontend.
  DIAN_SOFTWARE_ID: optionalText,
  DIAN_SOFTWARE_PIN: optionalText,
  DIAN_CLAVE_TECNICA: optionalText,
  DIAN_CERT_PATH: optionalText,
  DIAN_CERT_PASSWORD: optionalText,
  // Ubicacion del emisor con los codigos DANE que pide el XML UBL.
  EMISOR_MUNICIPIO_CODIGO: z.string().regex(/^\d{5}$/).default("05001"),
  EMISOR_CIUDAD: z.string().min(1).default("Medellín"),
  EMISOR_DEPARTAMENTO: z.string().min(1).default("Antioquia"),
  EMISOR_DEPARTAMENTO_CODIGO: z.string().regex(/^\d{2}$/).default("05"),
  // 1 = persona juridica, 2 = persona natural.
  EMISOR_TIPO_PERSONA: z.enum(["1", "2"]).default("1"),
  // Responsabilidades fiscales del RUT separadas por ';' (R-99-PN = no aplica / otros).
  EMISOR_RESPONSABILIDADES: z.string().min(1).default("R-99-PN"),
  // Carpeta donde se guardan los XML firmados y respuestas. Fuera del repositorio.
  STORAGE_DIR: z.string().min(1).default("storage"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Variables de entorno invalidas: ${details}`);
}

export const env = parsed.data;
