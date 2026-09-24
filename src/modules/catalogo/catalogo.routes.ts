import { Router } from "express";

import { authenticate, requireRole } from "../../middlewares/auth.js";
import { validateRequest } from "../../middlewares/validate-request.js";
import {
  createCatalogoItemController,
  getCatalogoItemController,
  listCatalogoController,
  updateCatalogoItemController,
} from "./catalogo.controller.js";
import {
  catalogoIdParamsSchema,
  catalogoQuerySchema,
  createCatalogoItemSchema,
  updateCatalogoItemSchema,
} from "./catalogo.schemas.js";

export const catalogoRouter = Router();

catalogoRouter.use(authenticate);

catalogoRouter.get(
  "/",
  requireRole("ADMINISTRADOR", "OPERADOR"),
  validateRequest({ query: catalogoQuerySchema }),
  listCatalogoController,
);

catalogoRouter.get(
  "/:id",
  requireRole("ADMINISTRADOR", "OPERADOR"),
  validateRequest({ params: catalogoIdParamsSchema }),
  getCatalogoItemController,
);

catalogoRouter.post(
  "/",
  requireRole("ADMINISTRADOR"),
  validateRequest({ body: createCatalogoItemSchema }),
  createCatalogoItemController,
);

catalogoRouter.patch(
  "/:id",
  requireRole("ADMINISTRADOR"),
  validateRequest({ params: catalogoIdParamsSchema, body: updateCatalogoItemSchema }),
  updateCatalogoItemController,
);
