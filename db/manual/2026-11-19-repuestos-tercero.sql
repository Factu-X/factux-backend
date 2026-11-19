-- Repuestos de tercero: lineas de orden/factura comprados a otro taller o distribuidor, sin item de catalogo.
-- Ejecutar una sola vez en el SQL Editor de Supabase. Es idempotente.
-- Despues de ejecutarlo, desde backend/:  npx prisma db sign

ALTER TABLE public.detalles_orden ALTER COLUMN item_catalogo_id DROP NOT NULL;
ALTER TABLE public.detalles_orden ADD COLUMN IF NOT EXISTS proveedor_tercero varchar(150);
ALTER TABLE public.detalles_factura ADD COLUMN IF NOT EXISTS proveedor_tercero varchar(150);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_detalle_orden_origen' AND conrelid = 'public.detalles_orden'::regclass
  ) THEN
    ALTER TABLE public.detalles_orden
      ADD CONSTRAINT chk_detalle_orden_origen CHECK (item_catalogo_id IS NOT NULL OR proveedor_tercero IS NOT NULL);
  END IF;
END $$;
