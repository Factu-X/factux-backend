import "dotenv/config";

import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  SUPABASE_URL: z.url("SUPABASE_URL debe ser una URL valida"),
  SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, "SUPABASE_PUBLISHABLE_KEY es obligatoria"),
  // Opcional: solo se necesita para crear usuarios en Supabase Auth desde la API.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // Lista separada por comas. Nunca se abre a cualquier origen; por defecto el front local.
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Variables de entorno invalidas: ${details}`);
}

export const env = parsed.data;
