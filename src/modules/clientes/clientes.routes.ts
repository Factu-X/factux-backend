import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import {
  createClienteController,
  getClienteController,
  listClientesController,
  updateClienteController,
} from "./clientes.controller.js";
import {
  clienteIdParamsSchema,
  clientesQuerySchema,
  createClienteSchema,
  updateClienteSchema,
} from "./clientes.schemas.js";

export const clientesRouter = Router();

clientesRouter.use(authenticate);

clientesRouter.get(
  "/",
  requireRole("ADMINISTRADOR", "OPERADOR"),
  validateRequest({ query: clientesQuerySchema }),
  listClientesController,
);

clientesRouter.get(
  "/:id",
  requireRole("ADMINISTRADOR", "OPERADOR"),
  validateRequest({ params: clienteIdParamsSchema }),
  getClienteController,
);

clientesRouter.post(
  "/",
  requireRole("ADMINISTRADOR", "OPERADOR"),
  validateRequest({ body: createClienteSchema }),
  createClienteController,
);

clientesRouter.patch(
  "/:id",
  requireRole("ADMINISTRADOR", "OPERADOR"),
  validateRequest({ params: clienteIdParamsSchema, body: updateClienteSchema }),
  updateClienteController,
);
