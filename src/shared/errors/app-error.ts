export type AppErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SERVICE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const invalidInput = (message: string) => new AppError("INVALID_INPUT", message, 400);
export const unauthenticated = (message = "로그인이 필요합니다.") => new AppError("UNAUTHENTICATED", message, 401);
export const forbidden = (message = "이 작업을 수행할 권한이 없습니다.") => new AppError("FORBIDDEN", message, 403);
export const notFound = (message: string) => new AppError("NOT_FOUND", message, 404);
export const conflict = (message: string) => new AppError("CONFLICT", message, 409);
export const serviceUnavailable = (message: string) => new AppError("SERVICE_UNAVAILABLE", message, 503);
export const rateLimited = (message: string) => new AppError("RATE_LIMITED", message, 429);

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError("INTERNAL_ERROR", "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500);
}
