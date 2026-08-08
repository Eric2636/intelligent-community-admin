export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly reason?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
