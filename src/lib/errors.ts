export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = (message = "Login required") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You are not allowed to do this") => new AppError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new AppError(404, "NOT_FOUND", message);
export const conflict = (message: string) => new AppError(409, "CONFLICT", message);
export const badRequest = (message: string) => new AppError(400, "BAD_REQUEST", message);
