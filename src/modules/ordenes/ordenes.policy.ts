import type { RolUsuario } from "../auth/types.js";
import { badRequest, forbidden } from "../../shared/http-error.js";
import type { EstadoOrden, UpdateOrdenInput } from "./ordenes.schemas.js";

const CLOSED_STATES: EstadoOrden[] = ["FINALIZADA", "CANCELADA"];

const TRANSICIONES: Record<EstadoOrden, EstadoOrden[]> = {
  ABIERTA: ["EN_PROCESO", "CANCELADA"],
  EN_PROCESO: ["ABIERTA", "FINALIZADA", "CANCELADA"],
  FINALIZADA: [],
  CANCELADA: [],
};

// El operario solo registra el avance del trabajo; los datos de recepcion son de facturacion.
const CAMPOS_OPERADOR = new Set<keyof UpdateOrdenInput>(["estado", "observaciones"]);

export const canModifyOrden = (estado: EstadoOrden) => !CLOSED_STATES.includes(estado);

export const assertOrdenEditable = (estado: EstadoOrden) => {
  if (!canModifyOrden(estado)) {
    throw forbidden("Las ordenes FINALIZADAS o CANCELADAS no admiten modificaciones");
  }
};

export const canTransitionOrden = (actual: EstadoOrden, siguiente: EstadoOrden) =>
  actual === siguiente || TRANSICIONES[actual].includes(siguiente);

export const assertTransicionOrden = (actual: EstadoOrden, siguiente: EstadoOrden) => {
  if (!canTransitionOrden(actual, siguiente)) {
    throw badRequest(`No se puede pasar una orden de ${actual} a ${siguiente}`);
  }
};

export const assertOrdenFinalizable = (cantidadDetalles: number) => {
  if (cantidadDetalles === 0) {
    throw badRequest("No se puede finalizar una orden sin servicios ni repuestos");
  }
};

export const assertRolPuedeActualizarOrden = (rol: RolUsuario, input: UpdateOrdenInput) => {
  if (rol !== "OPERADOR") {
    return;
  }

  const camposNoPermitidos = Object.keys(input).filter(
    (campo) => !CAMPOS_OPERADOR.has(campo as keyof UpdateOrdenInput),
  );

  if (camposNoPermitidos.length > 0) {
    throw forbidden(`El operario no puede modificar: ${camposNoPermitidos.join(", ")}`);
  }

  if (input.estado === "CANCELADA") {
    throw forbidden("El operario no puede cancelar ordenes");
  }
};
