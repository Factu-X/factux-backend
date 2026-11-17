import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import {
  cambiarEstadoRecordatorio,
  createRecordatorio,
  getRecordatorioById,
  listRecordatorios,
  notificarRecordatorio,
  notificarVencidos,
} from "./recordatorios.service.js";
import { recordatoriosQuerySchema } from "./recordatorios.schemas.js";
import type { CambiarEstadoInput, CreateRecordatorioInput, RecordatorioIdParams } from "./recordatorios.schemas.js";

export const listRecordatoriosController: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ data: await listRecordatorios(recordatoriosQuerySchema.parse(req.query)) });
});

export const getRecordatorioController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as RecordatorioIdParams;
  res.json({ data: await getRecordatorioById(id) });
});

export const createRecordatorioController: RequestHandler = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createRecordatorio(req.body as CreateRecordatorioInput, req.user?.id) });
});

export const cambiarEstadoController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as RecordatorioIdParams;
  res.json({ data: await cambiarEstadoRecordatorio(id, req.body as CambiarEstadoInput, req.user?.id) });
});

export const notificarRecordatorioController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as RecordatorioIdParams;
  res.json({ data: await notificarRecordatorio(id) });
});

export const notificarVencidosController: RequestHandler = asyncHandler(async (_req, res) => {
  res.json({ data: await notificarVencidos() });
});
