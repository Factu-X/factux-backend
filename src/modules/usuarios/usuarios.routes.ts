import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import {
  createUsuarioController,
  listUsuariosController,
  updateUsuarioController,
} from "./usuarios.controller.js";
import {
  createUsuarioSchema,
  updateUsuarioSchema,
  usuarioIdParamsSchema,
} from "./usuarios.schemas.js";

export const usuariosRouter = Router();

usuariosRouter.use(authenticate, requireRole("ADMINISTRADOR"));

usuariosRouter.get("/", listUsuariosController);

usuariosRouter.post("/", validateRequest({ body: createUsuarioSchema }), createUsuarioController);

usuariosRouter.patch(
  "/:id",
  validateRequest({ params: usuarioIdParamsSchema, body: updateUsuarioSchema }),
  updateUsuarioController,
);
