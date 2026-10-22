import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import {
  getConfiguracionController,
  updateEmpresaController,
  updateResolucionController,
} from "./configuracion.controller.js";
import { updateEmpresaSchema, updateResolucionSchema } from "./configuracion.schemas.js";

export const configuracionRouter = Router();

configuracionRouter.use(authenticate);

configuracionRouter.get(
  "/",
  requireRole("ADMINISTRADOR", "FACTURACION"),
  getConfiguracionController,
);

configuracionRouter.put(
  "/empresa",
  requireRole("ADMINISTRADOR"),
  validateRequest({ body: updateEmpresaSchema }),
  updateEmpresaController,
);

configuracionRouter.put(
  "/resolucion",
  requireRole("ADMINISTRADOR"),
  validateRequest({ body: updateResolucionSchema }),
  updateResolucionController,
);
