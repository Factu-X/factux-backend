import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import type {
  ClienteMotocicletasParams,
  CreateMotocicletaInput,
  MotocicletaIdParams,
  UpdateMotocicletaInput,
} from "./motocicletas.schemas.js";
import {
  createMotocicleta,
  getMotocicletaById,
  listMotocicletasByCliente,
  updateMotocicleta,
} from "./motocicletas.service.js";

export const listMotocicletasByClienteController: RequestHandler = asyncHandler(
  async (req, res) => {
    const { clienteId } = req.params as ClienteMotocicletasParams;
    const motocicletas = await listMotocicletasByCliente(clienteId);
    res.json({ data: motocicletas });
  },
);

export const getMotocicletaController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as MotocicletaIdParams;
  const motocicleta = await getMotocicletaById(id);
  res.json({ data: motocicleta });
});

export const createMotocicletaController: RequestHandler = asyncHandler(async (req, res) => {
  const { clienteId } = req.params as ClienteMotocicletasParams;
  const motocicleta = await createMotocicleta(clienteId, req.body as CreateMotocicletaInput);
  res.status(201).json({ data: motocicleta });
});

export const updateMotocicletaController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as MotocicletaIdParams;
  const motocicleta = await updateMotocicleta(id, req.body as UpdateMotocicletaInput);
  res.json({ data: motocicleta });
});
