# FactuX Backend

Backend REST para FactuX, sistema interno de gestion y facturacion electronica para un taller de motocicletas en Colombia.

## Stack

- Node.js + TypeScript
- Express
- Prisma 8 con contrato generado desde la base existente
- PostgreSQL en Supabase
- Supabase Auth
- Zod

## Requisitos

- Node.js 22 o superior.
- PostgreSQL 15 o superior en Supabase.
- Base de datos ya inicializada y verificada con el contrato Prisma 8.

Este proyecto usa el flujo nuevo de Prisma 8 con `src/prisma/contract.prisma`, `src/prisma/contract.json`, `src/prisma/contract.d.ts` y `src/prisma/db.ts`. No usa `PrismaClient` clasico ni `prisma/schema.prisma`.

## Instalacion

```bash
npm install
cp .env.example .env
```

Completa `.env` con los valores reales:

```env
PORT=4000
DATABASE_URL="postgresql://..."
SUPABASE_URL="https://tu-proyecto.supabase.co"
SUPABASE_PUBLISHABLE_KEY="..."
```

No uses ni expongas `SERVICE_ROLE_KEY` en el frontend.

## Comandos

```bash
npm run dev
npm run build
npm start
npm run db:seed
npm run prisma:infer
npm run prisma:emit
npm run prisma:verify
```

`npm run db:seed` crea datos DEMO idempotentes en tablas public. No inserta usuarios en `auth.users`.

## Estructura

```text
src/
  config/
  middlewares/
  modules/
    catalogo/
    clientes/
    motocicletas/
  prisma/
  scripts/
  shared/
  app.ts
  server.ts
```

Cada modulo separa rutas, controller, service y schemas Zod.

## Endpoints implementados

Health:

- `GET /api/health`

Clientes:

- `GET /api/clientes`
- `GET /api/clientes?search=texto`
- `GET /api/clientes/:id`
- `POST /api/clientes`
- `PATCH /api/clientes/:id`

Motocicletas:

- `GET /api/clientes/:clienteId/motocicletas`
- `POST /api/clientes/:clienteId/motocicletas`
- `GET /api/motocicletas/:id`
- `PATCH /api/motocicletas/:id`

Catalogo:

- `GET /api/catalogo`
- `GET /api/catalogo?tipo=SERVICIO`
- `GET /api/catalogo?tipo=REPUESTO`
- `GET /api/catalogo?activo=true`
- `GET /api/catalogo?search=aceite`
- `GET /api/catalogo/:id`
- `POST /api/catalogo`
- `PATCH /api/catalogo/:id`

Los endpoints de esta iteracion quedan sin proteccion obligatoria para facilitar pruebas iniciales. La infraestructura de autenticacion y RBAC ya existe en `src/middlewares/auth.ts` mediante `authenticate` y `requireRole(...)`.

## Autenticacion

El middleware espera:

```http
Authorization: Bearer <JWT>
```

Valida el token con Supabase Auth usando la publishable key y despues consulta `public.profiles`. Si `profile.activo = false`, rechaza la solicitud. El usuario queda disponible como:

```ts
req.user = {
  id,
  nombre,
  rol,
  activo,
};
```

Roles soportados:

- `ADMINISTRADOR`
- `OPERADOR`

## Crear el primer administrador

1. Crea el usuario inicial desde Supabase Auth.
2. El trigger `trg_auth_usuario_creado` debe crear su fila en `public.profiles`.
3. Promueve ese profile a administrador desde el SQL editor de Supabase:

```sql
update public.profiles
set rol = 'ADMINISTRADOR',
    activo = true
where id = '<auth_user_uuid>';
```

No insertes manualmente en `auth.users`.

## Notas tecnicas

- La base existente es la fuente de verdad.
- No se agregan migraciones ni `db push`.
- Prisma 8 usa `temporal-polyfill/global` porque Node 22 no expone `Temporal` global y el contrato usa columnas `timestamptz`.
- No hay inventario, stock, almacen ni proveedor en el modulo de catalogo.
