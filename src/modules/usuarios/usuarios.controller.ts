import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import type {
  CreateUsuarioInput,
  UpdateUsuarioInput,
  UsuarioIdParams,
} from "./usuarios.schemas.js";
import { createUsuario, listUsuarios, updateUsuario } from "./usuarios.service.js";

export const listUsuariosController: RequestHandler = asyncHandler(async (_req, res) => {
  const usuarios = await listUsuarios();
  res.json({ data: usuarios });
});

export const createUsuarioController: RequestHandler = asyncHandler(async (req, res) => {
  const usuario = await createUsuario(req.body as CreateUsuarioInput);
  res.status(201).json({ data: usuario });
});

export const updateUsuarioController: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as UsuarioIdParams;
  const usuario = await updateUsuario(id, req.body as UpdateUsuarioInput, req.user?.id);
  res.json({ data: usuario });
});
