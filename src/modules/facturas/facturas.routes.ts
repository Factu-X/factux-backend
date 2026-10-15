import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
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
