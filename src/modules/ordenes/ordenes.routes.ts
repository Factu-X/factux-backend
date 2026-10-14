import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import {
  addDetalleOrdenController,
  createOrdenController,
  deleteDetalleOrdenController,
  getOrdenController,
  listDetallesOrdenController,
  listOrdenesController,
  updateDetalleOrdenController,
  updateOrdenController,
} from "./ordenes.controller.js";
import {
  createOrdenDetalleSchema,
  createOrdenSchema,
  ordenDetalleIdParamsSchema,
  ordenesQuerySchema,
  ordenIdParamsSchema,
  updateOrdenDetalleSchema,
  updateOrdenSchema,
} from "./ordenes.schemas.js";

export const ordenesRouter = Router();

ordenesRouter.use(authenticate);

ordenesRouter.get(
  "/",
  requireRole("ADMINISTRADOR", "FACTURACION", "OPERADOR"),
  validateRequest({ query: ordenesQuerySchema }),
  listOrdenesController,
);

ordenesRouter.get(
  "/:id",
  requireRole("ADMINISTRADOR", "FACTURACION", "OPERADOR"),
  validateRequest({ params: ordenIdParamsSchema }),
  getOrdenController,
);

ordenesRouter.post(
  "/",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ body: createOrdenSchema }),
  createOrdenController,
);

ordenesRouter.patch(
  "/:id",
  requireRole("ADMINISTRADOR", "FACTURACION", "OPERADOR"),
  validateRequest({ params: ordenIdParamsSchema, body: updateOrdenSchema }),
  updateOrdenController,
);

ordenesRouter.get(
  "/:id/detalles",
  requireRole("ADMINISTRADOR", "FACTURACION", "OPERADOR"),
  validateRequest({ params: ordenIdParamsSchema }),
  listDetallesOrdenController,
);

ordenesRouter.post(
  "/:id/detalles",
  requireRole("ADMINISTRADOR", "FACTURACION", "OPERADOR"),
  validateRequest({ params: ordenIdParamsSchema, body: createOrdenDetalleSchema }),
  addDetalleOrdenController,
);

ordenesRouter.patch(
  "/:id/detalles/:detalleId",
  requireRole("ADMINISTRADOR", "FACTURACION", "OPERADOR"),
  validateRequest({
    params: ordenDetalleIdParamsSchema,
    body: updateOrdenDetalleSchema,
  }),
  updateDetalleOrdenController,
);

ordenesRouter.delete(
  "/:id/detalles/:detalleId",
  requireRole("ADMINISTRADOR", "FACTURACION", "OPERADOR"),
  validateRequest({ params: ordenDetalleIdParamsSchema }),
  deleteDetalleOrdenController,
);
