type ErrorClass<Failure extends Error> = abstract new (...args: never[]) => Failure;

/**
 * Awaits an operation that must fail with `errorClass` and returns the typed error.
 * Any other rejection is rethrown unchanged, and a success fails the test.
 */
export async function rejectionOf<Result, Failure extends Error>(
  pending: Result | PromiseLike<Result>,
  errorClass: ErrorClass<Failure>,
): Promise<Failure> {
  try {
    await pending;
  } catch (error) {
    if (error instanceof errorClass) return error;

    throw error;
  }

  throw new Error(`Expected the operation to reject with ${errorClass.name}.`);
}

/** Returns a value captured inside a callback, failing the test if it was never set. */
export function defined<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Expected the value to be captured.");

  return value;
}
