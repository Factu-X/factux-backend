import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import type { FacturaIdParams } from "../facturas/facturas.schemas.js";
import { enviarFactura, getPdfFactura, listEnviosFactura } from "./dian.service.js";

export const enviarFacturaController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as FacturaIdParams;
  res.json({ data: await enviarFactura(id) });
});

export const listEnviosController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as FacturaIdParams;
  res.json({ data: await listEnviosFactura(id) });
});

export const getPdfController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as FacturaIdParams;
  const { nombre, contenido } = await getPdfFactura(id);
  res.type("application/pdf").attachment(nombre).send(contenido);
});
