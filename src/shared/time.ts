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
