import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import { clientesQuerySchema } from "./clientes.schemas.js";
import type {
  ClienteIdParams,
  ClientesQuery,
  CreateClienteInput,
  UpdateClienteInput,
} from "./clientes.schemas.js";
import { createCliente, getClienteById, listClientes, updateCliente } from "./clientes.service.js";

export const listClientesController: RequestHandler = asyncHandler(async (req, res) => {
  const clientes = await listClientes(clientesQuerySchema.parse(req.query) as ClientesQuery);
  res.json({ data: clientes });
});

export const getClienteController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as ClienteIdParams;
  const cliente = await getClienteById(id);
  res.json({ data: cliente });
});

export const createClienteController: RequestHandler = asyncHandler(async (req, res) => {
  const cliente = await createCliente(req.body as CreateClienteInput);
  res.status(201).json({ data: cliente });
});

export const updateClienteController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as ClienteIdParams;
  const cliente = await updateCliente(id, req.body as UpdateClienteInput);
  res.json({ data: cliente });
});
