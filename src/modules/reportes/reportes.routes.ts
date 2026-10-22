import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { reporteFacturacionQuerySchema, type ReporteFacturacionQuery } from "./reportes.schemas.js";
import { getReporteFacturacion } from "./reportes.service.js";

export const reportesRouter = Router();

reportesRouter.get(
  "/facturacion",
  authenticate,
  requireRole("ADMINISTRADOR", "FACTURACION"),
  validateRequest({ query: reporteFacturacionQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json({ data: await getReporteFacturacion(reporteFacturacionQuerySchema.parse(req.query) as ReporteFacturacionQuery) });
  }),
);
