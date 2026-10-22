import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import type { FacturaIdParams } from "../facturas/facturas.schemas.js";
import { carteraQuerySchema } from "./cartera.schemas.js";
import type { CarteraQuery, RegistrarPagoInput } from "./cartera.schemas.js";
import { getCartera, getEstadoCuentaFactura, registrarPago } from "./cartera.service.js";

export const getCarteraController: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ data: await getCartera(carteraQuerySchema.parse(req.query) as CarteraQuery) });
});

export const getEstadoCuentaController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as FacturaIdParams;
  res.json({ data: await getEstadoCuentaFactura(id) });
});

export const registrarPagoController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as FacturaIdParams;
  res.status(201).json({ data: await registrarPago(id, req.body as RegistrarPagoInput, req.user?.id) });
});
