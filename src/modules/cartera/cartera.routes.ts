import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import { getCarteraController, listPagosController } from "./cartera.controller.js";
import { carteraQuerySchema, pagosQuerySchema } from "./cartera.schemas.js";

export const carteraRouter = Router();

carteraRouter.get(
  "/",
  authenticate,
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ query: carteraQuerySchema }),
  getCarteraController,
);

carteraRouter.get(
  "/pagos",
  authenticate,
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ query: pagosQuerySchema }),
  listPagosController,
);
