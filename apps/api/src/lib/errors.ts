export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    /** Extra JSON fields merged into the error response body, e.g. a conflict's current holder. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
