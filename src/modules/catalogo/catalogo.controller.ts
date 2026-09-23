import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import { catalogoQuerySchema } from "./catalogo.schemas.js";
import type {
  CatalogoIdParams,
  CatalogoQuery,
  CreateCatalogoItemInput,
  UpdateCatalogoItemInput,
} from "./catalogo.schemas.js";
import {
  createCatalogoItem,
  getCatalogoItemById,
  listCatalogo,
  updateCatalogoItem,
} from "./catalogo.service.js";

export const listCatalogoController: RequestHandler = asyncHandler(async (req, res) => {
  const catalogo = await listCatalogo(catalogoQuerySchema.parse(req.query) as CatalogoQuery);
  res.json({ data: catalogo });
});

export const getCatalogoItemController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as CatalogoIdParams;
  const item = await getCatalogoItemById(id);
  res.json({ data: item });
});

export const createCatalogoItemController: RequestHandler = asyncHandler(async (req, res) => {
  const item = await createCatalogoItem(req.body as CreateCatalogoItemInput);
  res.status(201).json({ data: item });
});

export const updateCatalogoItemController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as CatalogoIdParams;
  const item = await updateCatalogoItem(id, req.body as UpdateCatalogoItemInput);
  res.json({ data: item });
});
