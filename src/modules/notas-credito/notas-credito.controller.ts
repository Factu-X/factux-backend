import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import type { FacturaIdParams } from "../facturas/facturas.schemas.js";
import { notasCreditoQuerySchema } from "./notas-credito.schemas.js";
import type { CreateNotaCreditoInput, NotaCreditoIdParams, NotasCreditoQuery } from "./notas-credito.schemas.js";
import {
  createNotaCredito,
  enviarNotaCredito,
  getAcreditable,
  getNotaCreditoById,
  getPdfNota,
  getXmlNota,
  listEnviosNota,
  listNotasCredito,
} from "./notas-credito.service.js";

export const listNotasCreditoController: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ data: await listNotasCredito(notasCreditoQuerySchema.parse(req.query) as NotasCreditoQuery) });
});

export const getNotaCreditoController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as NotaCreditoIdParams;
  res.json({ data: await getNotaCreditoById(id) });
});

export const createNotaCreditoController: RequestHandler = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await createNotaCredito(req.body as CreateNotaCreditoInput, req.user?.id) });
});

export const enviarNotaCreditoController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as NotaCreditoIdParams;
  res.json({ data: await enviarNotaCredito(id) });
});

export const listEnviosNotaController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as NotaCreditoIdParams;
  res.json({ data: await listEnviosNota(id) });
});

export const getXmlNotaController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as NotaCreditoIdParams;
  const { nombre, contenido } = await getXmlNota(id);
  res.type("application/xml").attachment(nombre).send(contenido);
});

export const getPdfNotaController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as NotaCreditoIdParams;
  const { nombre, contenido } = await getPdfNota(id);
  res.type("application/pdf").attachment(nombre).send(contenido);
});

export const getAcreditableController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as FacturaIdParams;
  res.json({ data: await getAcreditable(id) });
});
