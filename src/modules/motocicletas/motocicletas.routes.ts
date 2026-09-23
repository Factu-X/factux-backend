import { Router } from "express";

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

clienteMotocicletasRouter.get(
  "/",
  validateRequest({ params: clienteMotocicletasParamsSchema }),
  listMotocicletasByClienteController,
);

clienteMotocicletasRouter.post(
  "/",
  validateRequest({
    params: clienteMotocicletasParamsSchema,
    body: createMotocicletaSchema,
  }),
  createMotocicletaController,
);

motocicletasRouter.get(
  "/:id",
  validateRequest({ params: motocicletaIdParamsSchema }),
  getMotocicletaController,
);

motocicletasRouter.patch(
  "/:id",
  validateRequest({ params: motocicletaIdParamsSchema, body: updateMotocicletaSchema }),
  updateMotocicletaController,
);
