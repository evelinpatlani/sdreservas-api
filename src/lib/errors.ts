export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, "BAD_REQUEST", msg, details);
export const unauthorized = (msg = "No autenticado") => new AppError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "No tienes permiso para esta acción") =>
  new AppError(403, "FORBIDDEN", msg);
export const notFound = (msg = "Recurso no encontrado") => new AppError(404, "NOT_FOUND", msg);
export const conflict = (msg: string) => new AppError(409, "CONFLICT", msg);
export const unprocessable = (msg: string, details?: unknown) =>
  new AppError(422, "UNPROCESSABLE", msg, details);
