import { Router } from "express";

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

catalogoRouter.get(
  "/",
  validateRequest({ query: catalogoQuerySchema }),
  listCatalogoController,
);

catalogoRouter.get(
  "/:id",
  validateRequest({ params: catalogoIdParamsSchema }),
  getCatalogoItemController,
);

catalogoRouter.post(
  "/",
  validateRequest({ body: createCatalogoItemSchema }),
  createCatalogoItemController,
);

catalogoRouter.patch(
  "/:id",
  validateRequest({ params: catalogoIdParamsSchema, body: updateCatalogoItemSchema }),
  updateCatalogoItemController,
);
