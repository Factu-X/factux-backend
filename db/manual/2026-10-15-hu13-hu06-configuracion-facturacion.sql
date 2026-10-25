-- HU-13 / HU-06: datos del emisor para el XML UBL, numeracion y secretos DIAN.
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente y solo agrega
-- (no borra ni modifica columnas existentes).
-- Despues de ejecutarlo, desde backend/:  npx prisma db sign

-- Emisor: campos que exige el Anexo Tecnico (direccion con codigo DANE y responsabilidades fiscales).
ALTER TABLE public.configuracion_empresa
  ADD COLUMN IF NOT EXISTS nombre_comercial varchar(200),
  ADD COLUMN IF NOT EXISTS tipo_persona varchar(10) NOT NULL DEFAULT 'JURIDICA',
  ADD COLUMN IF NOT EXISTS responsabilidades_fiscales varchar(100),
  ADD COLUMN IF NOT EXISTS ciudad varchar(100),
  ADD COLUMN IF NOT EXISTS departamento varchar(100),
  ADD COLUMN IF NOT EXISTS codigo_municipio varchar(5);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_empresa_tipo_persona') THEN
    ALTER TABLE public.configuracion_empresa
      ADD CONSTRAINT chk_empresa_tipo_persona CHECK (tipo_persona IN ('JURIDICA', 'NATURAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_empresa_codigo_municipio') THEN
    ALTER TABLE public.configuracion_empresa
      ADD CONSTRAINT chk_empresa_codigo_municipio CHECK (codigo_municipio IS NULL OR codigo_municipio ~ '^[0-9]{5}$');
  END IF;
END $$;

-- Software propio registrado ante la DIAN (no son secretos; el PIN si lo es y va a Vault).
ALTER TABLE public.configuracion_dian
  ADD COLUMN IF NOT EXISTS software_id varchar(100),
  ADD COLUMN IF NOT EXISTS test_set_id varchar(100);

-- Secretos (clave tecnica, PIN del software, contrasena del certificado) en Supabase Vault.
-- Solo service_role (el backend) puede ejecutar estas funciones; nunca anon ni authenticated.
CREATE OR REPLACE FUNCTION public.factux_guardar_secreto(p_nombre text, p_valor text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_nombre NOT IN ('factux_dian_clave_tecnica', 'factux_dian_pin', 'factux_dian_certificado_password') THEN
    RAISE EXCEPTION 'Secreto no permitido: %', p_nombre;
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = p_nombre;

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_valor, p_nombre);
  ELSE
    PERFORM vault.update_secret(v_id, p_valor);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.factux_leer_secreto(p_nombre text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets
  WHERE name = p_nombre AND p_nombre LIKE 'factux\_dian\_%';
$$;

CREATE OR REPLACE FUNCTION public.factux_secretos_configurados()
RETURNS SETOF text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT name FROM vault.secrets WHERE name LIKE 'factux\_dian\_%';
$$;

REVOKE ALL ON FUNCTION public.factux_guardar_secreto(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.factux_leer_secreto(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.factux_secretos_configurados() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.factux_guardar_secreto(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.factux_leer_secreto(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.factux_secretos_configurados() TO service_role;

-- Bucket privado para el certificado .p12 y los XML de facturas. Sin politicas: solo service_role accede.
INSERT INTO storage.buckets (id, name, public)
VALUES ('factux-privado', 'factux-privado', false)
ON CONFLICT (id) DO NOTHING;

-- Numeracion: consecutivo_actual es el ultimo numero emitido. Se inicializa en rango_desde - 1
-- para que la asignacion atomica de HU-06 nunca trabaje con NULL.
UPDATE public.configuracion_dian
SET consecutivo_actual = rango_desde - 1
WHERE consecutivo_actual IS NULL AND rango_desde IS NOT NULL;
