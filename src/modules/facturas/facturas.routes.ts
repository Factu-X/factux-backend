import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import {
  enviarFacturaController,
  getPdfController,
  getXmlController,
  listEnviosController,
} from "../dian/dian.controller.js";
import { getEstadoCuentaController, registrarPagoController } from "../cartera/cartera.controller.js";
import { registrarPagoSchema } from "../cartera/cartera.schemas.js";
import { getAcreditableController } from "../notas-credito/notas-credito.controller.js";
import {
  createFacturaController,
  getFacturaController,
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

facturasRouter.post(
  "/",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ body: createFacturaSchema }),
  createFacturaController,
);

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
  "/:id/xml",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: facturaIdParamsSchema }),
  getXmlController,
);

facturasRouter.get(
  "/:id/pdf",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: facturaIdParamsSchema }),
  getPdfController,
);

facturasRouter.get(
  "/:id/acreditable",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: facturaIdParamsSchema }),
  getAcreditableController,
);

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
