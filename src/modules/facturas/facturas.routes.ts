import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import { getEstadoCuentaController, registrarPagoController } from "../cartera/cartera.controller.js";
import { registrarPagoSchema } from "../cartera/cartera.schemas.js";
import {
  enviarFacturaController,
  getPdfController,
  listEnviosController,
} from "../dian/dian.controller.js";
import { getAcreditableController } from "../notas-credito/notas-credito.controller.js";
import {
  createFacturaController,
  getFacturaController,
  getFacturaXmlController,
  listDetallesFacturaController,
  listFacturasController,
} from "./facturas.controller.js";
import {
  createFacturaSchema,
  facturaIdParamsSchema,
  facturasQuerySchema,
} from "./facturas.schemas.js";

export const facturasRouter = Router();

facturasRouter.use(authenticate);

facturasRouter.get(
  "/",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ query: facturasQuerySchema }),
  listFacturasController,
);

facturasRouter.get(
  "/:id",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: facturaIdParamsSchema }),
  getFacturaController,
);

facturasRouter.get(
  "/:id/detalles",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: facturaIdParamsSchema }),
  listDetallesFacturaController,
);

facturasRouter.get(
  "/:id/xml",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: facturaIdParamsSchema }),
  getFacturaXmlController,
);

// Una factura confirmada no se modifica: no existen rutas PATCH/PUT/DELETE (HU-06).
facturasRouter.post(
  "/",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ body: createFacturaSchema }),
  createFacturaController,
);

// HU-07: firma y envio a la DIAN (simulador), historial de intentos y representacion grafica.
facturasRouter.post(
  "/:id/enviar",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: facturaIdParamsSchema }),
  enviarFacturaController,
);

facturasRouter.get(
  "/:id/envios",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: facturaIdParamsSchema }),
  listEnviosController,
);

facturasRouter.get(
  "/:id/pdf",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: facturaIdParamsSchema }),
  getPdfController,
);

// HU-08: lo que queda por acreditar de cada linea.
facturasRouter.get(
  "/:id/acreditable",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: facturaIdParamsSchema }),
  getAcreditableController,
);

// HU-10: estado de cuenta y registro de pagos.
facturasRouter.get(
  "/:id/cuenta",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: facturaIdParamsSchema }),
  getEstadoCuentaController,
);

facturasRouter.post(
  "/:id/pagos",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: facturaIdParamsSchema, body: registrarPagoSchema }),
  registrarPagoController,
);
