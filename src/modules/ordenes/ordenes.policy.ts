import { forbidden } from "../../shared/http-error.js";
import type { EstadoOrden } from "./ordenes.schemas.js";

const CLOSED_STATES: EstadoOrden[] = ["FINALIZADA", "CANCELADA"];

export const canModifyOrden = (estado: EstadoOrden) => !CLOSED_STATES.includes(estado);

export const assertOrdenEditable = (estado: EstadoOrden) => {
  if (!canModifyOrden(estado)) {
    throw forbidden("Las ordenes FINALIZADAS o CANCELADAS no admiten modificaciones");
  }
};
