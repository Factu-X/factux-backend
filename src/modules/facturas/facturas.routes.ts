import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
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
  requireRole("ADMINISTRADOR", "OPERADOR"),
  validateRequest({ query: facturasQuerySchema }),
  listFacturasController,
);

facturasRouter.get(
  "/:id",
  requireRole("ADMINISTRADOR", "OPERADOR"),
  validateRequest({ params: facturaIdParamsSchema }),
  getFacturaController,
);

facturasRouter.get(
  "/:id/detalles",
  requireRole("ADMINISTRADOR", "OPERADOR"),
  validateRequest({ params: facturaIdParamsSchema }),
  listDetallesFacturaController,
);

facturasRouter.post(
  "/",
  requireRole("ADMINISTRADOR", "OPERADOR"),
  validateRequest({ body: createFacturaSchema }),
  createFacturaController,
);
