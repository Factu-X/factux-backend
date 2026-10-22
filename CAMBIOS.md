# Cambios en el backend · rama `Camilo-Rama`

Resumen de lo que se agregó o modificó en `factux-backend-main` durante las fases A, B y C del plan de cierre.
El frontend tiene su propio `CAMBIOS.md`.

No hay cambios al esquema de la base: todo usa las tablas que ya existían.

## Resumen por historia de usuario

| HU | Qué quedó | Endpoints |
|---|---|---|
| HU-13 | Configuración de empresa y resolución de numeración, con alertas | `GET /api/configuracion`, `PUT /api/configuracion/empresa`, `PUT /api/configuracion/resolucion` |
| HU-06 | Factura numerada desde la resolución vigente, con filtros y detalle completo | `GET/POST /api/facturas`, `GET /api/facturas/:id` |
| HU-07 | XML UBL 2.1 con CUFE, firma XAdES, envío al simulador DIAN, historial y PDF con QR | `POST /api/facturas/:id/enviar`, `GET /:id/envios`, `GET /:id/xml`, `GET /:id/pdf` |
| HU-08 | Notas crédito totales y parciales con CUDE, envío, XML y PDF | `/api/notas-credito`, `GET /api/facturas/:id/acreditable` |
| HU-10 | Cartera por antigüedad y registro de pagos | `GET /api/cartera`, `GET /api/facturas/:id/cuenta`, `POST /api/facturas/:id/pagos` |
| HU-09 | Reporte de facturación por rango de fechas | `GET /api/reportes/facturacion` |

## Detalle

### Seguridad y arranque
- `src/app.ts`: CORS limitado a `CORS_ORIGINS` (vacío = cualquier origen, solo desarrollo), límite de peticiones por minuto (`express-rate-limit`) y logs de acceso (`morgan`).
- `src/middlewares/auth.ts`: el token se verifica con `supabase.auth.getClaims()`, que valida localmente la firma ES256 en lugar de consultar a Supabase en cada petición. Las peticiones pasaron de 0,5–1,7 s a ~300 ms. Desactivar un usuario sigue siendo inmediato porque se revisa `profiles.activo`.
- `package.json`: `"type": "module"`. Corrige `npm start`, que fallaba con "Cannot use import statement outside a module".

### HU-13 · Configuración (`src/modules/configuracion/`)
- Valida el dígito de verificación del NIT con los pesos de la DIAN (`src/shared/nit.ts`).
- Valida rango (desde ≤ hasta), vigencia y prefijo (máximo 4 caracteres).
- Si cambia la resolución o el prefijo, el consecutivo vuelve a empezar.
- Alertas que bloquean la facturación: no hay resolución, la resolución está vencida o todavía no está vigente, o se agotó el rango.
- Advertencias: queda menos del 10 % del rango o faltan menos de 30 días para el vencimiento.
- Los parámetros del software (`DIAN_*`) solo se informan como presentes o ausentes; nunca salen del servidor.

### HU-06 · Facturas (`src/modules/facturas/`)
- El número es prefijo + consecutivo de la resolución. El consecutivo se reserva con un UPDATE condicional, así dos facturas simultáneas nunca comparten número.
- Rechaza facturar si la resolución bloquea. Una factura a crédito no puede vencer antes de hoy.
- El listado acepta `search`, `estadoDian`, `clienteId`, `formaPago`, `limit` y `offset`, e incluye cliente, orden y moto. El detalle incluye además las líneas con su tratamiento de IVA.
- Se quitó la reescritura de totales de la orden, que no cambiaba nada.

### HU-07 · Facturación electrónica (`src/modules/dian/`)
- `cufe.ts`: CUFE y CUDE con SHA-384. Un test lo compara con el ejemplo oficial del Anexo Técnico 1.9.
- `ubl.ts`: XML UBL 2.1 con DianExtensions, emisor, adquirente, IVA agrupado por tarifa (los excluidos no entran a la base gravable), líneas y QR.
- `signer.ts`: firma XAdES-EPES con la política de firma v2 de la DIAN, dentro de la segunda `UBLExtension`. Incluye una corrección al transform *enveloped* de `xmldsigjs`, que solo quitaba firmas colgadas de la raíz.
- `gateway.ts`: interfaz `DianGateway` y `SimuladorDianGateway`.
  - El simulador verifica firma, CUFE/CUDE, totales, rango y número de líneas.
  - Responde `00` (validado) o `99` (rechazado) con reglas `SIM-*`.
  - Para pasar a la DIAN real basta con implementar la versión SOAP de esa interfaz.
- `dian.service.ts`: cada intento queda registrado en `envios_dian`.
  - Una factura no se puede enviar dos veces al mismo tiempo.
  - Las rechazadas o con error de conexión se pueden reintentar.
  - El XML firmado y la respuesta se guardan en `STORAGE_DIR`.
- `pdf.ts`: representación gráfica con CUFE/CUDE y QR. Sin CUFE lleva la marca "SIN VALIDEZ FISCAL".
- `certificado-pruebas.ts`: certificado autofirmado para el ambiente simulado.

### HU-08 · Notas crédito (`src/modules/notas-credito/`, `src/modules/dian/ubl-nota-credito.ts`)
- Solo se emiten sobre facturas validadas.
- **Total:** acredita todo lo que queda. **Parcial:** acredita las líneas y cantidades elegidas, sin superar lo facturado menos las notas anteriores.
- XML `CreditNote` con referencia al CUFE de la factura, concepto de corrección 1 (parcial) o 2 (anulación) y CUDE calculado con el PIN del software.
- Numeración `NC-000001`, que se reintenta si dos notas chocan.

### HU-10 · Cartera (`src/modules/cartera/`)
- Saldo = total − notas crédito **validadas** − pagos. Nunca es negativo.
- Antigüedad: al día, 1–30, 31–60, 61–90 y más de 90 días. Las facturas de contado vencen el día de emisión.
- Un pago no puede superar el saldo ni registrarse sobre una factura anulada, y su fecha no puede ser futura.

### HU-09 · Reporte (`src/modules/reportes/`)
- Rango por defecto: el mes en curso. Máximo un año; los días son de Colombia.
- Incluye facturado, IVA, notas crédito, neto, recaudo por método, ticket promedio, serie diaria, 8 ítems más vendidos, 5 mejores clientes, conteo por estado DIAN y la cartera de hoy.

## Variables de entorno nuevas (`.env.example`)

| Variable | Uso |
|---|---|
| `CORS_ORIGINS` | Orígenes permitidos, separados por coma |
| `RATE_LIMIT_PER_MINUTE` | Límite por IP (por defecto 300) |
| `DIAN_SOFTWARE_ID`, `DIAN_SOFTWARE_PIN`, `DIAN_CLAVE_TECNICA` | Parámetros del software ante la DIAN |
| `DIAN_CERT_PATH`, `DIAN_CERT_PASSWORD` | Certificado de firma (.p12), fuera del repositorio |
| `EMISOR_MUNICIPIO_CODIGO`, `EMISOR_CIUDAD`, `EMISOR_DEPARTAMENTO`, `EMISOR_DEPARTAMENTO_CODIGO`, `EMISOR_TIPO_PERSONA`, `EMISOR_RESPONSABILIDADES` | Datos del emisor para el XML (por defecto Medellín, persona jurídica) |
| `STORAGE_DIR` | Carpeta de XML y respuestas (por defecto `storage/`) |

## Scripts nuevos

```bash
npm run dian:setup -- --env      # genera certs/factux-pruebas.p12 y agrega las variables DIAN al .env
npm run verificar:dian           # crea, envía y verifica una factura de punta a punta, mostrando cada paso
npm run verificar:dian -- --factura SETP990000000   # solo revisa una factura existente
```

`npm run db:seed` ahora también crea la resolución de pruebas `SETP` (990000000–995000000) si no existe, y corrige el DV de la empresa demo de 7 a 8.

## Dependencias nuevas

`express-rate-limit`, `morgan`, `xmlbuilder2`, `xadesjs`, `xmldsigjs`, `@xmldom/xmldom`, `xpath`, `node-forge`, `pdfkit` y `qrcode`. En desarrollo: `@types/morgan`, `@types/node-forge`, `@types/pdfkit` y `@types/qrcode`.

`.gitignore` ahora excluye `certs/`, `storage/`, `*.p12` y `*.pfx`.

## Pruebas

Se pasó de 86 a **163 tests**. Archivos nuevos:

- `configuracion.rules.test.ts`
- `dian.ubl.test.ts`
- `dian.signer.test.ts`
- `dian.gateway.test.ts`
- `dian.nota-credito.test.ts`
- `fase-c.rules.test.ts`
- `fixtures/dian.ts`

`rbac.routes.test.ts` cubre las rutas nuevas.

## Lo que esto escribió en la base de desarrollo compartida

- Resolución de pruebas `SETP` y DV de la empresa demo en 8, por el seed.
- Facturas `SETP990000000` y `SETP990000001`, validadas en el simulador, y la orden `OS-20261022173336-XUKY`.
- Dos envíos rechazados de `FV-000001`, que es anterior a la resolución.
- Nota crédito `NC-000001` (parcial, validada) y un pago de prueba de $50.000 (`TRF-PRUEBA-001`).

## Pendiente

- La DIAN real: requiere NIT habilitado, certificado de una entidad acreditada y la implementación SOAP de `DianGateway`.
- Fase D: recordatorios con correo, pruebas de usabilidad, Docker, despliegue y documentación final.
