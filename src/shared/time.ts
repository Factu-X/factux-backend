import "temporal-polyfill/global";

import { badRequest } from "./http-error.js";

export const parseInstant = (value: string, fieldName: string): Temporal.Instant => {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw badRequest(`${fieldName} debe ser una fecha ISO valida`);
  }
};

export const nowInstant = (): Temporal.Instant => Temporal.Now.instant();

// Las fechas de negocio (vigencias, emision) se evaluan en hora de Colombia.
export const ZONA_COLOMBIA = "America/Bogota";

export const hoyColombia = (): string => Temporal.Now.plainDateISO(ZONA_COLOMBIA).toString();
