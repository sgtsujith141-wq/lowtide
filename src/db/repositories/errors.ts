/*
 * Domain errors thrown by repositories.
 *
 * Names must not match DOMException/IndexedDB error names (e.g. `NotFoundError`,
 * `InvalidStateError`): Dexie maps errors with those names to its own DexieError
 * classes when they escape a transaction, and `instanceof` checks then fail.
 */

export class RecordNotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`);
    this.name = 'RecordNotFoundError';
  }
}

/** The operation is not allowed in the record's current state. */
export class RecordStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordStateError';
  }
}

/**
 * Input that is well-formed for storage but wrong for its context, e.g. a
 * `check` habit logged with a value other than 1, or a target on a `check`
 * habit. (Named to avoid DOMException names such as `InvalidStateError`.)
 */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

/** A SPACE page changed since the revision an editor saved against. */
export class SpaceConflictError extends Error {
  constructor(
    message: string,
    readonly revision?: number,
  ) {
    super(message);
    this.name = 'SpaceConflictError';
  }
}
