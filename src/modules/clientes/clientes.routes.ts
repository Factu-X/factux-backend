import { Router } from "express";

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

clientesRouter.get(
  "/",
  validateRequest({ query: clientesQuerySchema }),
  listClientesController,
);

clientesRouter.get(
  "/:id",
  validateRequest({ params: clienteIdParamsSchema }),
  getClienteController,
);

clientesRouter.post(
  "/",
  validateRequest({ body: createClienteSchema }),
  createClienteController,
);

clientesRouter.patch(
  "/:id",
  validateRequest({ params: clienteIdParamsSchema, body: updateClienteSchema }),
  updateClienteController,
);
