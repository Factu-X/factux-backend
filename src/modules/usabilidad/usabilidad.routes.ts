import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import {
  createSesionController,
  deleteSesionController,
  getInformeController,
  getResumenController,
  getSesionController,
  getTareasBaseController,
  listSesionesController,
  updateHallazgoController,
} from "./usabilidad.controller.js";
import {
  createSesionSchema,
  hallazgoIdParamsSchema,
  sesionIdParamsSchema,
  updateHallazgoSchema,
} from "./usabilidad.schemas.js";

export const usabilidadRouter = Router();

// El front solo muestra "Usabilidad" al administrador; el backend lo exige igual.
usabilidadRouter.use(authenticate, requireRole("ADMINISTRADOR"));

usabilidadRouter.get("/tareas-base", getTareasBaseController);
usabilidadRouter.get("/resumen", getResumenController);
usabilidadRouter.get("/informe", getInformeController);
usabilidadRouter.get("/sesiones", listSesionesController);
usabilidadRouter.post("/sesiones", validateRequest({ body: createSesionSchema }), createSesionController);

const conId = validateRequest({ params: sesionIdParamsSchema });

usabilidadRouter.get("/sesiones/:id", conId, getSesionController);
usabilidadRouter.delete("/sesiones/:id", conId, deleteSesionController);
usabilidadRouter.patch(
  "/hallazgos/:id",
  validateRequest({ params: hallazgoIdParamsSchema, body: updateHallazgoSchema }),
  updateHallazgoController,
);
