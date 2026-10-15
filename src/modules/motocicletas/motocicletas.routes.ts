import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import {
  createMotocicletaController,
  getMotocicletaController,
  listMotocicletasByClienteController,
  updateMotocicletaController,
} from "./motocicletas.controller.js";
import {
  clienteMotocicletasParamsSchema,
  createMotocicletaSchema,
  motocicletaIdParamsSchema,
  updateMotocicletaSchema,
} from "./motocicletas.schemas.js";

export const motocicletasRouter = Router();
export const clienteMotocicletasRouter = Router({ mergeParams: true });

motocicletasRouter.use(authenticate);
clienteMotocicletasRouter.use(authenticate);

clienteMotocicletasRouter.get(
  "/",
  requireRole("ADMINISTRADOR", "FACTURACION", "OPERADOR"),
  validateRequest({ params: clienteMotocicletasParamsSchema }),
  listMotocicletasByClienteController,
);

clienteMotocicletasRouter.post(
  "/",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({
    params: clienteMotocicletasParamsSchema,
    body: createMotocicletaSchema,
  }),
  createMotocicletaController,
);

motocicletasRouter.get(
  "/:id",
  requireRole("ADMINISTRADOR", "FACTURACION", "OPERADOR"),
  validateRequest({ params: motocicletaIdParamsSchema }),
  getMotocicletaController,
);

motocicletasRouter.patch(
  "/:id",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ params: motocicletaIdParamsSchema, body: updateMotocicletaSchema }),
  updateMotocicletaController,
);
