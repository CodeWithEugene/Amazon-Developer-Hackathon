/**
 * Store-layer errors with an HTTP meaning. Route handlers map them through
 * `storeErrorResponse` (lib/api.ts). Messages are safe to show to users.
 */

export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409
  ) {
    super(message)
    this.name = new.target.name
  }
}

/** A record that does not exist. The message ends in "not found". */
export class NotFoundError extends StoreError {
  constructor(what: string) {
    super(`${what} not found`, 404)
  }
}

/** Input that fails a business rule (for example, departure before arrival). */
export class ValidationError extends StoreError {
  constructor(message: string) {
    super(message, 400)
  }
}

/** A state transition that is not allowed (for example, resolving twice). */
export class ConflictError extends StoreError {
  constructor(message: string) {
    super(message, 409)
  }
}

/** The family's consent does not allow this read or write. */
export class ConsentError extends StoreError {
  constructor(message: string) {
    super(message, 403)
  }
}

export const notFound = (what: string): never => {
  throw new NotFoundError(what)
}
