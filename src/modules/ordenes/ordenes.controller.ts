import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import { ordenesQuerySchema } from "./ordenes.schemas.js";
import type {
  CreateOrdenDetalleInput,
  CreateOrdenInput,
  OrdenDetalleIdParams,
  OrdenIdParams,
  OrdenesQuery,
  UpdateOrdenDetalleInput,
  UpdateOrdenInput,
} from "./ordenes.schemas.js";
import {
  addDetalleOrden,
  createOrden,
  deleteDetalleOrden,
  getOrdenById,
  listDetallesOrden,
  listOrdenes,
  updateDetalleOrden,
  updateOrden,
} from "./ordenes.service.js";

export const listOrdenesController: RequestHandler = asyncHandler(async (req, res) => {
  const ordenes = await listOrdenes(ordenesQuerySchema.parse(req.query) as OrdenesQuery);
  res.json({ data: ordenes });
});

export const getOrdenController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as OrdenIdParams;
  const orden = await getOrdenById(id);
  res.json({ data: orden });
});

export const createOrdenController: RequestHandler = asyncHandler(async (req, res) => {
  const orden = await createOrden(req.body as CreateOrdenInput, req.user?.id);
  res.status(201).json({ data: orden });
});

export const updateOrdenController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as OrdenIdParams;
  const orden = await updateOrden(id, req.body as UpdateOrdenInput);
  res.json({ data: orden });
});

export const listDetallesOrdenController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as OrdenIdParams;
  const detalles = await listDetallesOrden(id);
  res.json({ data: detalles });
});

export const addDetalleOrdenController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as OrdenIdParams;
  const orden = await addDetalleOrden(id, req.body as CreateOrdenDetalleInput);
  res.status(201).json({ data: orden });
});

export const updateDetalleOrdenController: RequestHandler = asyncHandler(async (req, res) => {
  const { id, detalleId } = req.params as OrdenDetalleIdParams;
  const detalle = await updateDetalleOrden(id, detalleId, req.body as UpdateOrdenDetalleInput);
  res.json({ data: detalle });
});

export const deleteDetalleOrdenController: RequestHandler = asyncHandler(async (req, res) => {
  const { id, detalleId } = req.params as OrdenDetalleIdParams;
  const orden = await deleteDetalleOrden(id, detalleId);
  res.json({ data: orden });
});
