export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: ErrorCode,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string) => new HttpError(400, message, "BAD_REQUEST");
export const unauthorized = (message = "Autenticacion requerida") =>
  new HttpError(401, message, "UNAUTHORIZED");
export const forbidden = (message = "No tienes permisos para esta accion") =>
  new HttpError(403, message, "FORBIDDEN");
export const notFound = (message = "Recurso no encontrado") =>
  new HttpError(404, message, "NOT_FOUND");
export const conflict = (message: string) => new HttpError(409, message, "CONFLICT");
