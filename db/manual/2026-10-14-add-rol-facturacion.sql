-- HU-12: agrega el rol FACTURACION (Administrador / Facturacion / Operador).
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
--
-- No se usa `prisma db update` porque su plan tambien elimina profiles_id_fkey
-- (FK hacia auth.users, fuera del contrato), lo cual es destructivo.
-- Despues de ejecutarlo, desde backend/:  npx prisma db sign
ALTER TYPE public.rol_usuario ADD VALUE IF NOT EXISTS 'FACTURACION';
