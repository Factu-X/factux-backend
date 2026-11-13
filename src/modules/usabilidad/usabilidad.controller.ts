import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import type { CreateSesionInput, UpdateHallazgoInput } from "./usabilidad.schemas.js";
import {
  createSesion,
  deleteSesion,
  getInformeMarkdown,
  getResumen,
  getSesionById,
  listSesiones,
  updateHallazgo,
} from "./usabilidad.service.js";
import { SUS_PROMEDIO_REFERENCIA, TAREAS_BASE } from "./usabilidad.rules.js";

export const getTareasBaseController: RequestHandler = (_req, res) => {
  res.json({ data: { tareas: TAREAS_BASE, referenciaSus: SUS_PROMEDIO_REFERENCIA } });
};

export const listSesionesController: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ data: await listSesiones() });
});

export const getSesionController: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ data: await getSesionById(req.params["id"] as string) });
});

export const createSesionController: RequestHandler = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createSesion(req.body as CreateSesionInput, req.user?.id) });
});

export const deleteSesionController: RequestHandler = asyncHandler(async (req, res) => {
  await deleteSesion(req.params["id"] as string);
  res.status(204).send();
});

export const updateHallazgoController: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ data: await updateHallazgo(req.params["id"] as string, req.body as UpdateHallazgoInput) });
});

export const getResumenController: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ data: await getResumen() });
});

export const getInformeController: RequestHandler = asyncHandler(async (_req, res) => {
  res
    .type("text/markdown; charset=utf-8")
    .set("Content-Disposition", 'attachment; filename="informe-usabilidad.md"')
    .send(await getInformeMarkdown());
});
