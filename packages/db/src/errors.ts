/** Base class for every error raised by the access layer. */
export class DbError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

/** The on-disk demo store or a query cursor could not be parsed. */
export class MalformedDataError extends DbError {}

export const isConditionalCheckFailure = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  (error as { name?: unknown }).name === "ConditionalCheckFailedException"
