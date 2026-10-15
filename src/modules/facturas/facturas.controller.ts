import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import { facturasQuerySchema } from "./facturas.schemas.js";
import type { CreateFacturaInput, FacturaIdParams, FacturasQuery } from "./facturas.schemas.js";
import {
  createFacturaFromOrden,
  getFacturaById,
  getFacturaXml,
  listDetallesFactura,
  listFacturas,
} from "./facturas.service.js";

export const listFacturasController: RequestHandler = asyncHandler(async (req, res) => {
  const facturas = await listFacturas(facturasQuerySchema.parse(req.query) as FacturasQuery);
  res.json({ data: facturas });
});

export const getFacturaController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as FacturaIdParams;
  const factura = await getFacturaById(id);
  res.json({ data: factura });
});

export const listDetallesFacturaController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as FacturaIdParams;
  const detalles = await listDetallesFactura(id);
  res.json({ data: detalles });
});

export const createFacturaController: RequestHandler = asyncHandler(async (req, res) => {
  const factura = await createFacturaFromOrden(req.body as CreateFacturaInput, req.user?.id);
  res.status(201).json({ data: factura });
});

export const getFacturaXmlController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as FacturaIdParams;
  const { numero, xml } = await getFacturaXml(id);
  res
    .type("application/xml")
    .attachment(`${numero}.xml`)
    .send(xml);
});
