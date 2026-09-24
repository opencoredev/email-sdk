/**
 * Runtime decoding for values the type system cannot vouch for: parsed JSON bodies,
 * caught errors, environment input, and values supplied by JavaScript callers.
 *
 * The package ships without a schema library, so this module is the one place that
 * classifies raw runtime values. Everything else branches on the decoded domain value.
 * Classification uses `Object(value) !== value` to detect primitives and the
 * `Object.prototype.toString` tag to name them, which matches `typeof` for every
 * primitive and function the SDK accepts.
 */

/** A value produced by `JSON.parse`. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

/** A JSON object produced by `JSON.parse`. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** A callable value whose signature is not known until it is invoked. */
export type UnknownFunction = (...args: never[]) => void;

const FUNCTION_TAGS = new Set([
  "[object Function]",
  "[object AsyncFunction]",
  "[object GeneratorFunction]",
  "[object AsyncGeneratorFunction]",
]);

function tagOf<T>(value: T): string {
  return Object.prototype.toString.call(value);
}

function isPrimitive<T>(value: T): boolean {
  return Object(value) !== value;
}

/**
 * Narrow a statically typed union to its string members, for example the `string` side
 * of `EmailAddress` or an attachment's `content`.
 */
export function isStringMember<T>(value: T): value is Extract<T, string> {
  return isPrimitive(value) && tagOf(value) === "[object String]";
}

export function isString(value: unknown): value is string {
  return isPrimitive(value) && tagOf(value) === "[object String]";
}

export function isNumber(value: unknown): value is number {
  return isPrimitive(value) && tagOf(value) === "[object Number]";
}

export function isBoolean(value: unknown): value is boolean {
  return value === true || value === false;
}

export function isFunction(value: unknown): value is UnknownFunction {
  return FUNCTION_TAGS.has(tagOf(value));
}

/** Narrow a statically typed union to its function members, such as a value-or-factory option. */
export function isFunctionMember<T>(value: T): value is Extract<T, UnknownFunction> {
  return FUNCTION_TAGS.has(tagOf(value));
}

/** Non-null objects and functions: values that can carry properties. */
export function isObjectLike(value: unknown): value is object {
  return value !== null && value !== undefined && Object(value) === value;
}

/** Narrow a JSON value to a JSON object. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== undefined && value !== null && !Array.isArray(value) && Object(value) === value;
}

/** Read a JSON object field, or `undefined` when the value is not an object. */
export function jsonField(value: JsonValue | undefined, key: string): JsonValue | undefined {
  return isJsonObject(value) ? value[key] : undefined;
}

/** Read a string JSON object field. */
export function jsonString(value: JsonValue | undefined, key: string): string | undefined {
  const field = jsonField(value, key);

  return isJsonString(field) ? field : undefined;
}

/** Narrow a JSON value to a string. */
export function isJsonString(value: JsonValue | undefined): value is string {
  return isPrimitive(value) && tagOf(value) === "[object String]";
}

/** Narrow a JSON value to a boolean. */
export function isJsonBoolean(value: JsonValue | undefined): value is boolean {
  return value === true || value === false;
}

/** Narrow a JSON value to a number. */
export function isJsonNumber(value: JsonValue | undefined): value is number {
  return isPrimitive(value) && tagOf(value) === "[object Number]";
}

/** Read an array JSON object field, or an empty array. */
export function jsonArray(value: JsonValue | undefined, key: string): readonly JsonValue[] {
  const field = jsonField(value, key);

  return Array.isArray(field) ? field : [];
}

/** Parse text as JSON, throwing a SyntaxError for malformed input like `JSON.parse`. */
export function parseJsonStrict(text: string): JsonValue {
  // SAFETY: JSON.parse without a reviver only produces strings, numbers, booleans, null,
  // arrays, and plain objects, which is exactly JsonValue.
  return JSON.parse(text) as JsonValue;
}

/** Parse text as JSON, returning `undefined` for malformed input. */
export function parseJson(text: string): JsonValue | undefined {
  try {
    return parseJsonStrict(text);
  } catch {
    return undefined;
  }
}

/** Read a response body as JSON, returning `undefined` when it is empty or malformed. */
export async function readJson(response: Response): Promise<JsonValue | undefined> {
  const text = await response.text().catch(() => "");

  return text ? parseJson(text) : undefined;
}

type ThrownFields = { code?: unknown; message?: unknown; name?: unknown; responseCode?: unknown };

/** Read a response body as JSON, rejecting on malformed input like `response.json()`. */
export async function responseJson(response: Response): Promise<JsonValue> {
  // SAFETY: Response.json() parses the body with JSON parsing rules, which only produce
  // JsonValue.
  return (await response.json()) as JsonValue;
}

/**
 * Read a successful response body as JSON. Empty, unreadable, or malformed bodies become `{}`,
 * matching `response.json().catch(() => ({}))`.
 */
export async function readJsonBody(response: Response): Promise<JsonValue> {
  const parsed = await readJson(response).catch(() => undefined);

  return parsed === undefined ? {} : parsed;
}

/** Read a string property, such as `code`, from a thrown value. */
export function causeString(cause: unknown, key: "code" | "message" | "name"): string | undefined {
  if (!isObjectLike(cause)) {
    return undefined;
  }

  const fields: ThrownFields = cause;
  const field = fields[key];

  return isString(field) ? field : undefined;
}

/** Read a numeric property, such as an SMTP `responseCode`, from a thrown value. */
export function causeNumber(cause: unknown, key: "responseCode"): number | undefined {
  if (!isObjectLike(cause)) {
    return undefined;
  }

  const fields: ThrownFields = cause;
  const field = fields[key];

  return isNumber(field) ? field : undefined;
}
