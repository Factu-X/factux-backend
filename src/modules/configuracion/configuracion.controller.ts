import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import type { UpdateEmpresaInput, UpdateResolucionInput } from "./configuracion.schemas.js";
import { getConfiguracion, updateEmpresa, updateResolucion } from "./configuracion.service.js";

export const getConfiguracionController: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ data: await getConfiguracion() });
});

export const updateEmpresaController: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ data: await updateEmpresa(req.body as UpdateEmpresaInput) });
});

export const updateResolucionController: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ data: await updateResolucion(req.body as UpdateResolucionInput) });
});
