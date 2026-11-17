-- HU-14: pruebas de usabilidad con usuarios piloto (sesiones, tareas, hallazgos y puntaje SUS).
-- HU-11 no necesita SQL: la tabla recordatorios_mantenimiento ya existe.
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente y solo agrega tablas nuevas.
-- Despues de ejecutarlo, desde backend/:  npx prisma db sign

CREATE TABLE IF NOT EXISTS public.usabilidad_sesiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participante varchar(150) NOT NULL,
  perfil varchar(200),
  fecha_sesion date NOT NULL DEFAULT CURRENT_DATE,
  observaciones text,
  -- Las 10 respuestas del cuestionario SUS (1 a 5) como arreglo JSON, p. ej. [4,2,5,1,4,2,5,1,4,2].
  sus_respuestas text NOT NULL,
  -- Puntaje 0-100 calculado por el backend al guardar la sesion.
  sus_puntaje numeric(5, 2) NOT NULL,
  creada_por uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_usabilidad_sus_puntaje CHECK (sus_puntaje >= 0 AND sus_puntaje <= 100)
);

CREATE TABLE IF NOT EXISTS public.usabilidad_tareas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id uuid NOT NULL REFERENCES public.usabilidad_sesiones (id) ON DELETE CASCADE,
  tarea varchar(250) NOT NULL,
  completada boolean NOT NULL DEFAULT false,
  errores integer NOT NULL DEFAULT 0,
  observaciones text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_usabilidad_tarea_errores CHECK (errores >= 0)
);

CREATE TABLE IF NOT EXISTS public.usabilidad_hallazgos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id uuid NOT NULL REFERENCES public.usabilidad_sesiones (id) ON DELETE CASCADE,
  descripcion text NOT NULL,
  pantalla varchar(100),
  prioridad varchar(10) NOT NULL,
  -- true cuando la mejora ya se llevo al backlog (las criticas entran marcadas desde el registro).
  en_backlog boolean NOT NULL DEFAULT false,
  resuelto boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_usabilidad_hallazgo_prioridad CHECK (prioridad IN ('CRITICA', 'ALTA', 'MEDIA', 'BAJA'))
);

CREATE INDEX IF NOT EXISTS idx_usabilidad_sesiones_fecha ON public.usabilidad_sesiones (fecha_sesion);
CREATE INDEX IF NOT EXISTS idx_usabilidad_tareas_sesion ON public.usabilidad_tareas (sesion_id);
CREATE INDEX IF NOT EXISTS idx_usabilidad_hallazgos_sesion ON public.usabilidad_hallazgos (sesion_id);

-- Como el resto de tablas: RLS activa y sin politicas. Solo el backend (conexion directa) lee y escribe;
-- anon y authenticated no pueden tocarlas por la API REST de Supabase.
ALTER TABLE public.usabilidad_sesiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usabilidad_tareas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usabilidad_hallazgos ENABLE ROW LEVEL SECURITY;
