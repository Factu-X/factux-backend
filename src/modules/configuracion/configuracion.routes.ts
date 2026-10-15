import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import {
  getConfiguracionController,
  updateCertificadoController,
  updateCredencialesController,
  updateEmpresaController,
  updateNumeracionController,
} from "./configuracion.controller.js";
import {
  updateCertificadoSchema,
  updateCredencialesSchema,
  updateEmpresaSchema,
  updateNumeracionSchema,
} from "./configuracion.schemas.js";

export const configuracionRouter = Router();

configuracionRouter.use(authenticate);

// HU-13: Facturacion consulta; solo el administrador modifica. El operario no tiene acceso.
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
  "/numeracion",
  requireRole("ADMINISTRADOR"),
  validateRequest({ body: updateNumeracionSchema }),
  updateNumeracionController,
);

configuracionRouter.put(
  "/credenciales",
  requireRole("ADMINISTRADOR"),
  validateRequest({ body: updateCredencialesSchema }),
  updateCredencialesController,
);

configuracionRouter.put(
  "/certificado",
  requireRole("ADMINISTRADOR"),
  validateRequest({ body: updateCertificadoSchema }),
  updateCertificadoController,
);
