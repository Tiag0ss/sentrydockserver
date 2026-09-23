export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Safe client-facing error payload — never leak internals. */
export function clientError(err: unknown, fallback = 'request failed'): { status: number; body: { error: string; code?: string } } {
  if (err instanceof AppError) {
    return { status: err.statusCode, body: { error: err.message, code: err.code } };
  }
  return { status: 500, body: { error: fallback } };
}
