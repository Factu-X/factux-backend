import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import {
  createNotaCreditoController,
  enviarNotaCreditoController,
  getNotaCreditoController,
  getPdfNotaController,
  getXmlNotaController,
  listEnviosNotaController,
  listNotasCreditoController,
} from "./notas-credito.controller.js";
import {
  createNotaCreditoSchema,
  notaCreditoIdParamsSchema,
  notasCreditoQuerySchema,
} from "./notas-credito.schemas.js";

export const notasCreditoRouter = Router();

notasCreditoRouter.use(authenticate, requireRole("ADMINISTRADOR", "FACTURACION"));

notasCreditoRouter.get("/", validateRequest({ query: notasCreditoQuerySchema }), listNotasCreditoController);
notasCreditoRouter.post("/", validateRequest({ body: createNotaCreditoSchema }), createNotaCreditoController);

const conId = validateRequest({ params: notaCreditoIdParamsSchema });

notasCreditoRouter.get("/:id", conId, getNotaCreditoController);
notasCreditoRouter.post("/:id/enviar", conId, enviarNotaCreditoController);
notasCreditoRouter.get("/:id/envios", conId, listEnviosNotaController);
notasCreditoRouter.get("/:id/xml", conId, getXmlNotaController);
notasCreditoRouter.get("/:id/pdf", conId, getPdfNotaController);
