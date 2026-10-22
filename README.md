# FactuX Backend

Backend REST para FactuX, sistema interno de gestion, ordenes de servicio y facturacion interna para un taller de motocicletas en Colombia.

## Estado Actual

Implementado:

- Autenticacion con Supabase Auth y JWT Bearer.
- Perfil y rol desde `public.profiles`.
- RBAC con roles `ADMINISTRADOR`, `FACTURACION` y `OPERADOR`.
- Gestion de usuarios (crear en Supabase Auth, cambiar rol, activar/desactivar).
- Clientes.
- Motocicletas.
- Catalogo de servicios/repuestos.
- Ordenes de servicio con detalles y calculo automatico de totales.
- Facturas internas generadas desde ordenes finalizadas.
- Seed demo idempotente con empresa, clientes, motos, catalogo, orden y factura demo.
- Tests, lint, typecheck, build y GitHub Actions CI.
- SonarCloud preparado como siguiente capa.

No implementado todavia:

- Envio DIAN.
- CUFE real.
- XML/PDF fiscal real.
- Notas credito.
- Cuentas por cobrar.
- Dashboard real.

## Stack

- Node.js 22 + TypeScript
- Express
- Prisma 8 con contrato inferido desde la base existente
- PostgreSQL en Supabase
- Supabase Auth
- Zod
- Vitest + Supertest
- ESLint

## Arquitectura

```text
React/Vite
  -> Express REST API
  -> Prisma 8
  -> PostgreSQL / Supabase

Supabase Auth
  -> JWT Bearer
  -> middleware backend
  -> public.profiles / roles
```

## Requisitos

- Node.js 22 o superior.
- Base PostgreSQL/Supabase ya inicializada.
- Contrato Prisma 8 vigente en `src/prisma/contract.prisma`, `contract.json` y `contract.d.ts`.

No ejecutar `migrate`, `db push`, `reset` ni crear `prisma/schema.prisma` sin aprobacion previa. La base existente es la fuente de verdad.

## Instalacion

```bash
npm install
cp .env.example .env
```

Variables principales:

```env
PORT=4000
DATABASE_URL="postgresql://..."
SUPABASE_URL="https://tu-proyecto.supabase.co"
SUPABASE_PUBLISHABLE_KEY="..."
# Solo para POST /api/usuarios. Sin ella el resto de la API funciona y crear usuarios responde 503.
SUPABASE_SERVICE_ROLE_KEY="..."
# Opcionales
CORS_ORIGINS="http://localhost:5173"   # vacio = cualquier origen (solo desarrollo)
RATE_LIMIT_PER_MINUTE=300
DIAN_SOFTWARE_ID="" DIAN_SOFTWARE_PIN="" DIAN_CLAVE_TECNICA="" DIAN_CERT_PATH="" DIAN_CERT_PASSWORD=""
```

No commitear `.env`. No exponer `SERVICE_ROLE_KEY` al frontend.

## Manejo Del .env En Equipo

La forma recomendada es:

1. Mantener `.env.example` versionado con nombres de variables y placeholders.
2. Compartir valores reales por un canal seguro:
   - gestor de contrasenas del equipo,
   - 1Password/Bitwarden,
   - secreto temporal,
   - mensaje cifrado,
   - o acceso directo al proyecto Supabase para que cada integrante copie sus propias keys.
3. Configurar GitHub Actions con GitHub Secrets/Variables, no con archivos `.env`.

Evitar mandar `.env` por WhatsApp si contiene `DATABASE_URL`, passwords o secret keys. Si se manda por urgencia, rotar credenciales despues.

## Cambios Manuales De Base De Datos

`db/manual/` guarda SQL aplicado a mano en Supabase cuando `prisma db update` propone operaciones
destructivas (por ejemplo, borrar `profiles_id_fkey`, que apunta a `auth.users` fuera del contrato).
Despues de aplicarlo: `npx prisma db sign`.

- `2026-10-14-add-rol-facturacion.sql` (aplicado el 2026-10-14).

## Comandos

```bash
npm run dev
npm run typecheck
npm run lint
npm run test
npm run test:coverage
npm run build
npm run db:seed
npm start
```

## Puesta En Marcha Local

1. Instalar dependencias:

```bash
npm install
```

2. Configurar `.env`.

3. Verificar contrato Prisma 8 contra la base:

```bash
npm run prisma:verify
```

No usar `prisma migrate`, `db push`, `reset` ni crear `prisma/schema.prisma`.

4. Ejecutar seed:

```bash
npm run db:seed
```

El seed crea/actualiza:

- empresa demo,
- resolucion de pruebas DIAN (`SETP`, 990000000-995000000) si no existe,
- 2 clientes,
- 3 motocicletas,
- 8 items de catalogo,
- una orden finalizada demo,
- una factura interna demo.

5. Confirmar calidad:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

6. Levantar API:

```bash
npm run dev
```

7. Probar:

```bash
curl http://localhost:4000/api/health
```

## Endpoints Principales

Health:

- `GET /api/health`

Auth:

- `GET /api/auth/me`

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
- `GET /api/catalogo?tipo=SERVICIO|REPUESTO&activo=true&search=aceite`
- `GET /api/catalogo/:id`
- `POST /api/catalogo`
- `PATCH /api/catalogo/:id`

Ordenes:

- `GET /api/ordenes`
- `GET /api/ordenes?estado=ABIERTA`
- `GET /api/ordenes/:id`
- `POST /api/ordenes`
- `PATCH /api/ordenes/:id`
- `GET /api/ordenes/:id/detalles`
- `POST /api/ordenes/:id/detalles`
- `PATCH /api/ordenes/:id/detalles/:detalleId`
- `DELETE /api/ordenes/:id/detalles/:detalleId`

Usuarios (solo `ADMINISTRADOR`):

- `GET /api/usuarios`
- `POST /api/usuarios` (`nombre`, `email`, `password`, `rol`)
- `PATCH /api/usuarios/:id` (`nombre`, `rol`, `activo`)

Facturas:

- `GET /api/facturas?search=&estadoDian=&clienteId=&formaPago=&limit=50&offset=0` (incluye cliente, orden y moto)
- `GET /api/facturas/:id` (incluye cliente, orden, moto y detalles con tratamiento de IVA)
- `GET /api/facturas/:id/detalles`
- `POST /api/facturas` (`ordenId`, `formaPago`, `fechaVencimiento` si es credito)
- `POST /api/facturas/:id/enviar`: genera el XML UBL 2.1 con CUFE, lo firma y lo envia al simulador DIAN. Sirve tambien para reintentar una rechazada.
- `GET /api/facturas/:id/envios`: historial de intentos con codigo y mensaje de respuesta.
- `GET /api/facturas/:id/xml`: XML firmado (despues del primer envio).
- `GET /api/facturas/:id/pdf`: representacion grafica con CUFE y QR (sin CUFE sale marcada "sin validez fiscal").

Notas credito (HU-08):

- `GET /api/notas-credito` y `GET /api/notas-credito/:id`
- `GET /api/facturas/:id/acreditable`: lo que queda por acreditar de cada linea.
- `POST /api/notas-credito` (`facturaId`, `tipoAjuste` TOTAL|PARCIAL, `motivo`, `lineas` si es parcial). Solo sobre facturas VALIDADAS; las cantidades no pueden superar lo facturado menos notas anteriores.
- `POST /api/notas-credito/:id/enviar`, `GET /:id/envios`, `GET /:id/xml`, `GET /:id/pdf`: igual que facturas, con CUDE (SHA-384 con el PIN del software) y concepto de correccion 1 (parcial) o 2 (anulacion).

Cartera (HU-10):

- `GET /api/cartera?filtro=CON_SALDO|VENCIDAS|TODAS`: resumen (por cobrar, vencido, antiguedad 0/1-30/31-60/61-90/+90) y facturas con saldo.
- `GET /api/facturas/:id/cuenta`: total, notas credito, pagos y saldo de una factura.
- `POST /api/facturas/:id/pagos` (`monto`, `metodoPago`, `referencia`, `fechaPago`): no permite pagar mas que el saldo ni pagar facturas anuladas.
- Saldo = total - notas credito VALIDADAS - pagos. Las facturas de contado vencen el dia de emision.

Reporte (HU-09):

- `GET /api/reportes/facturacion?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` (por defecto, el mes en curso): facturado, IVA, notas credito, neto, recaudo, serie diaria, top items y clientes, estados DIAN y la cartera de hoy.

Configuracion (HU-13):

- `GET /api/configuracion` (`ADMINISTRADOR`, `FACTURACION`): empresa, resolucion, si los parametros del software estan configurados y alertas.
- `PUT /api/configuracion/empresa` (`ADMINISTRADOR`): valida el digito de verificacion del NIT.
- `PUT /api/configuracion/resolucion` (`ADMINISTRADOR`): prefijo, numero, rango y vigencia. Cambiar resolucion o prefijo reinicia el consecutivo.

Todos los endpoints de negocio requieren:

```http
Authorization: Bearer <JWT>
```

## Facturacion Electronica (Ambiente Simulado)

El modulo `src/modules/dian/` trabaja como software propio segun el Anexo Tecnico 1.9:

- `ubl.ts` arma el XML UBL 2.1 (DianExtensions, emisor, adquirente, IVA agrupado por tarifa, lineas).
- `cufe.ts` calcula CUFE/CUDE con SHA-384; un test lo compara con el ejemplo oficial del anexo.
- `signer.ts` firma XAdES-EPES con la politica de firma v2 de la DIAN, dentro de la segunda `UBLExtension`.
- `gateway.ts` define `DianGateway`. Hoy lo implementa `SimuladorDianGateway`, que verifica firma, CUFE,
  totales, rango y lineas, y responde `00` (validada) o `99` (rechazada) con reglas `SIM-*`.
- Los XML firmados y las respuestas se guardan en `STORAGE_DIR` (por defecto `storage/`, fuera de git).

Preparar el ambiente (genera un certificado autofirmado en `certs/` y las variables `DIAN_*`):

```bash
npm run dian:setup -- --env
```

Recorrido completo con resultados visibles (crea, envia y verifica una factura, y deja el XML y el PDF en storage/):

```bash
npm run verificar:dian                              # factura la primera orden finalizada pendiente
npm run verificar:dian -- --factura SETP990000000   # solo revisa una factura existente
```

Para pasar a la DIAN real faltan: NIT habilitado, certificado de una entidad acreditada y una
implementacion SOAP de `DianGateway`.

## Roles

| Recurso | ADMINISTRADOR | FACTURACION | OPERADOR |
|---|---|---|---|
| Usuarios | CRUD | - | - |
| Catalogo | CRUD | lectura | lectura |
| Clientes / motocicletas | CRUD | CRUD | lectura |
| Ordenes | CRUD | CRUD | lectura, estado (sin cancelar), observaciones, detalles |
| Facturas | CRUD | CRUD | - |

La matriz completa esta cubierta por `tests/rbac.routes.test.ts`.

El middleware valida el JWT con Supabase Auth, consulta `public.profiles`, exige `activo = true` y adjunta `req.user`.

## Reglas De Negocio Implementadas

- Placas de motocicleta con formato `AAA00A`.
- Clientes no se eliminan fisicamente; se desactivan.
- Motocicletas no se eliminan fisicamente; se desactivan.
- Catalogo no maneja inventario en este MVP.
- Detalles de orden toman snapshot desde `items_catalogo`.
- Totales de orden se calculan en backend.
- Ordenes `FINALIZADAS` y `CANCELADAS` no admiten cambios de detalles.
- Estados: `ABIERTA -> EN_PROCESO -> FINALIZADA`, `EN_PROCESO -> ABIERTA`, y `CANCELADA` desde abierta o en proceso.
- Una orden se crea `ABIERTA` o `EN_PROCESO`; no se puede finalizar sin detalles.
- `GET /api/ordenes` y `GET /api/ordenes/:id` incluyen `cliente` y `motocicleta`.
- Un administrador no puede desactivarse ni cambiarse el rol a si mismo.
- Facturas se generan solo desde ordenes `FINALIZADAS`.
- Una orden solo puede tener una factura.
- El numero de factura sale de la resolucion vigente (`prefijo + consecutivo`). Se rechaza si no hay
  resolucion, si esta vencida o si el rango se agoto. El consecutivo se reserva con un UPDATE condicional,
  asi dos facturas simultaneas no comparten numero.
- Las facturas quedan `estadoDian = PENDIENTE_ENVIO` hasta que exista el modulo DIAN (HU-07).
- Los parametros del software DIAN (`DIAN_*`) viven solo en variables de entorno del backend.

## GitHub Actions

`.github/workflows/ci.yml` ejecuta obligatoriamente:

1. `npm ci`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test`
5. `npm run build`

`.github/workflows/sonar.yml` queda preparado como siguiente capa. Ejecuta cobertura y SonarCloud solo si existen:

- GitHub Secret `SONAR_TOKEN`
- GitHub Variable `SONAR_PROJECT_KEY`
- GitHub Variable `SONAR_ORGANIZATION`

SonarCloud deberia revisar:

- bugs,
- code smells,
- duplicacion,
- coverage,
- security hotspots.

## Estructura

```text
src/
  config/
  middlewares/
  modules/
    auth/
    catalogo/
    clientes/
    facturas/
    motocicletas/
    ordenes/
  prisma/
  scripts/
  shared/
tests/
.github/workflows/
```

## Pendientes Para El Equipo

- Conectar dashboard a consultas reales de resumen.
- Crear endpoint de resumen para KPIs.
- Agregar filtros/paginacion en listados grandes.
- Mejorar DTOs de respuesta para facturas incluyendo cliente, moto y detalles en una sola respuesta.
- Agregar pruebas de integracion con base de datos de test aislada.
- Agregar generacion PDF interna de factura.
- Implementar pagos/cuentas por cobrar.
- Implementar notas credito.
- Implementar DIAN: CUFE, XML, firma, envio, estados y reintentos.
- Revisar vulnerabilidades transitivas reportadas por `npm audit` en backend.
- Subir umbral minimo de coverage cuando haya mas tests.
