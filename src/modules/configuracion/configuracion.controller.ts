import type { RequestHandler } from "express";

import { asyncHandler } from "../../shared/async-handler.js";
import type {
  UpdateCertificadoInput,
  UpdateCredencialesInput,
  UpdateEmpresaInput,
  UpdateNumeracionInput,
} from "./configuracion.schemas.js";
import {
  getConfiguracion,
  updateCertificado,
  updateCredenciales,
  updateEmpresa,
  updateNumeracion,
} from "./configuracion.service.js";

// Cada cambio responde con la configuracion completa para que la pantalla se refresque.
const guardarYResponder = <Input>(guardar: (input: Input) => Promise<unknown>): RequestHandler =>
  asyncHandler(async (req, res) => {
    await guardar(req.body as Input);
    res.json({ data: await getConfiguracion(req.user!.rol) });
  });

export const getConfiguracionController: RequestHandler = asyncHandler(async (req, res) => {
  res.json({ data: await getConfiguracion(req.user!.rol) });
});

export const updateEmpresaController = guardarYResponder<UpdateEmpresaInput>(updateEmpresa);
export const updateNumeracionController = guardarYResponder<UpdateNumeracionInput>(updateNumeracion);
export const updateCredencialesController =
  guardarYResponder<UpdateCredencialesInput>(updateCredenciales);
export const updateCertificadoController = guardarYResponder<UpdateCertificadoInput>(updateCertificado);
