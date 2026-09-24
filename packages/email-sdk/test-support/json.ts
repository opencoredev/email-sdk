/** A value that survives `JSON.stringify`, used for stubbed provider response bodies. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

/** `undefined` members are allowed because `JSON.stringify` drops them, as the tests rely on. */
export type JsonObject = { readonly [key: string]: JsonValue | undefined };
