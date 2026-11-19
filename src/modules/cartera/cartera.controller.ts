import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import type { FacturaIdParams } from "../facturas/facturas.schemas.js";
import { carteraQuerySchema, pagosQuerySchema } from "./cartera.schemas.js";
import type { CarteraQuery, PagosQuery, RegistrarPagoInput } from "./cartera.schemas.js";
import { getCartera, getEstadoCuentaFactura, registrarPago } from "./cartera.service.js";
import { listPagos } from "../reportes/reportes.service.js";

export const getCarteraController: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ data: await getCartera(carteraQuerySchema.parse(req.query) as CarteraQuery) });
});

export const listPagosController: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ data: await listPagos(pagosQuerySchema.parse(req.query) as PagosQuery) });
});

export const getEstadoCuentaController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as FacturaIdParams;
  res.json({ data: await getEstadoCuentaFactura(id) });
});

export const registrarPagoController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as FacturaIdParams;
  res.status(201).json({ data: await registrarPago(id, req.body as RegistrarPagoInput, req.user?.id) });
});
