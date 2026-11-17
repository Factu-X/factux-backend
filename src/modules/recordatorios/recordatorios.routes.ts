import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import {
  cambiarEstadoController,
  createRecordatorioController,
  getRecordatorioController,
  listRecordatoriosController,
  notificarRecordatorioController,
  notificarVencidosController,
} from "./recordatorios.controller.js";
import {
  cambiarEstadoSchema,
  createRecordatorioSchema,
  recordatorioIdParamsSchema,
  recordatoriosQuerySchema,
} from "./recordatorios.schemas.js";

export const recordatoriosRouter = Router();

// Igual que el menu del front: Administrador y Facturacion gestionan recordatorios; el operario no.
recordatoriosRouter.use(authenticate, requireRole("ADMINISTRADOR", "FACTURACION"));

recordatoriosRouter.get("/", validateRequest({ query: recordatoriosQuerySchema }), listRecordatoriosController);
recordatoriosRouter.post("/", validateRequest({ body: createRecordatorioSchema }), createRecordatorioController);
// Antes de "/:id" para que "notificar" no se lea como un id.
recordatoriosRouter.post("/notificar", notificarVencidosController);

const conId = validateRequest({ params: recordatorioIdParamsSchema });

recordatoriosRouter.get("/:id", conId, getRecordatorioController);
recordatoriosRouter.patch(
  "/:id/estado",
  validateRequest({ params: recordatorioIdParamsSchema, body: cambiarEstadoSchema }),
  cambiarEstadoController,
);
recordatoriosRouter.post("/:id/notificar", conId, notificarRecordatorioController);
