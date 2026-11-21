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

function isCallable<T>(value: T): boolean {
  if (isPrimitive(value)) return false;

  try {
    Object.getPrototypeOf(value);
    Function.prototype.toString.call(value);

    return true;
  } catch {
    return false;
  }
}

export function isFunction(value: unknown): value is UnknownFunction {
  return isCallable(value);
}

/** Narrow a statically typed union to its function members, such as a value-or-factory option. */
export function isFunctionMember<T>(value: T): value is Extract<T, UnknownFunction> {
  return isCallable(value);
}

/** Non-null objects and functions: values that can carry properties. */
export function isObjectLike(value: unknown): value is object {
  return value !== null && value !== undefined && Object(value) === value;
}

/** Non-null, non-array objects: safe across realms and null prototypes. */
export function isNonArrayObject<T>(value: T): boolean {
  return value !== null && value !== undefined && !Array.isArray(value) && Object(value) === value;
}

const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

const sharedArrayBufferByteLength = isFunction(globalThis.SharedArrayBuffer)
  ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")?.get
  : undefined;

const blobSizeGetter = isFunction(globalThis.Blob)
  ? Object.getOwnPropertyDescriptor(Blob.prototype, "size")?.get
  : undefined;

const mapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;

const setSizeGetter = Object.getOwnPropertyDescriptor(Set.prototype, "size")?.get;

const regExpSourceGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")?.get;

const regExpFlagsGetter = Object.getOwnPropertyDescriptor(RegExp.prototype, "flags")?.get;

const urlHrefGetter = isFunction(globalThis.URL)
  ? Object.getOwnPropertyDescriptor(URL.prototype, "href")?.get
  : undefined;

function hasGetterBrand<T>(getter: ((this: T) => T) | undefined, value: T): boolean {
  if (!getter) return false;

  try {
    getter.call(value);

    return true;
  } catch {
    return false;
  }
}

function isBuiltInValueObject<T>(value: T): boolean {
  return (
    isFunctionMember(value) ||
    hasGetterBrand(arrayBufferByteLength, value) ||
    hasGetterBrand(sharedArrayBufferByteLength, value) ||
    ArrayBuffer.isView(value) ||
    hasGetterBrand(blobSizeGetter, value) ||
    hasGetterBrand(regExpSourceGetter, value) ||
    hasGetterBrand(mapSizeGetter, value) ||
    hasGetterBrand(setSizeGetter, value) ||
    hasGetterBrand(urlHrefGetter, value)
  );
}

/** True for real ArrayBuffer and SharedArrayBuffer instances across realms (rejects spoofed tags and prototypes). */
export function isBinaryBuffer(value: unknown): value is ArrayBufferLike {
  if (isPrimitive(value)) return false;

  if (arrayBufferByteLength) {
    try {
      arrayBufferByteLength.call(value);

      return true;
    } catch {
      // Not an ArrayBuffer; check SharedArrayBuffer below.
    }
  }

  if (sharedArrayBufferByteLength) {
    try {
      sharedArrayBufferByteLength.call(value);

      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/** True for real Date instances across realms (rejects spoofed tags and prototypes). */
export function isDateLike(value: unknown): value is Date {
  if (isPrimitive(value)) return false;

  try {
    Date.prototype.getTime.call(value);

    return true;
  } catch {
    return false;
  }
}

/** True for Blob/File instances, including cross-realm Blobs implementing arrayBuffer(). */
export function isBlobLike<T>(value: T): value is Extract<T, Blob> {
  if (isPrimitive(value)) return false;

  if (value instanceof Blob) {
    if (!blobSizeGetter) return true;

    try {
      blobSizeGetter.call(value);

      return true;
    } catch {
      return false;
    }
  }

  const tag = tagOf(value);

  if (tag !== "[object Blob]" && tag !== "[object File]") return false;

  // SAFETY: Cross-realm Blob/File duck-type check before calling arrayBuffer().
  return isFunction((value as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer);
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

type ThrownFields = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  responseCode?: unknown;
  status?: unknown;
};

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
export function causeNumber(cause: unknown, key: "responseCode" | "status"): number | undefined {
  if (!isObjectLike(cause)) {
    return undefined;
  }

  const fields: ThrownFields = cause;
  const field = fields[key];

  return isNumber(field) ? field : undefined;
}

function cloneDateValue<T>(value: T): Date | undefined {
  try {
    return new Date(Date.prototype.getTime.call(value));
  } catch {
    return undefined;
  }
}

function cloneArrayBufferView(view: ArrayBufferView): ArrayBufferView {
  const copied = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();

  if (view instanceof DataView) return new DataView(copied.buffer);

  if (view instanceof Int8Array) return new Int8Array(copied.buffer);

  if (view instanceof Uint8ClampedArray) return new Uint8ClampedArray(copied.buffer);

  if (view instanceof Int16Array) return new Int16Array(copied.buffer);

  if (view instanceof Uint16Array) return new Uint16Array(copied.buffer);

  if (view instanceof Int32Array) return new Int32Array(copied.buffer);

  if (view instanceof Uint32Array) return new Uint32Array(copied.buffer);

  if (view instanceof Float32Array) return new Float32Array(copied.buffer);

  if (view instanceof Float64Array) return new Float64Array(copied.buffer);

  if (view instanceof BigInt64Array) return new BigInt64Array(copied.buffer);

  if (view instanceof BigUint64Array) return new BigUint64Array(copied.buffer);

  return copied;
}

function cloneBinaryBufferValue<T>(value: T): ArrayBufferLike | undefined {
  if (hasGetterBrand(arrayBufferByteLength, value)) {
    return ArrayBuffer.prototype.slice.call(value, 0);
  }

  if (
    sharedArrayBufferByteLength &&
    hasGetterBrand(sharedArrayBufferByteLength, value) &&
    isFunction(globalThis.SharedArrayBuffer)
  ) {
    return SharedArrayBuffer.prototype.slice.call(value, 0);
  }

  return undefined;
}

function cloneRegExpValue<T>(value: T): RegExp | undefined {
  if (!regExpSourceGetter || !hasGetterBrand(regExpSourceGetter, value)) return undefined;

  const source = String(regExpSourceGetter.call(value));
  const flags = regExpFlagsGetter ? String(regExpFlagsGetter.call(value)) : "";
  const copy = new RegExp(source, flags);
  const desc = Object.getOwnPropertyDescriptor(value, "lastIndex");

  if (desc && isNumber(desc.value)) copy.lastIndex = desc.value;

  return copy;
}

/** Recursively clone plain objects, arrays, Dates, Maps, Sets, and binary views inside a metadata record. */
export function cloneMetadataRecord<T>(metadata: T): T {
  const seen = new Map();

  function clone<V>(value: V): V {
    if (isPrimitive(value) || value === null || value === undefined) return value;

    const cached = seen.get(value);

    if (cached !== undefined) return cached;

    const clonedDate = cloneDateValue(value);

    if (clonedDate !== undefined) {
      // SAFETY: Input passed Date brand check; returning a cloned Date matches V.
      return clonedDate as V;
    }

    if (Array.isArray(value)) {
      const arr: V[] = [];
      seen.set(value, arr);

      for (const item of value) {
        arr.push(clone(item));
      }

      // SAFETY: Cloning each element of an array produces an array matching V.
      return arr as V;
    }

    if (ArrayBuffer.isView(value)) {
      // SAFETY: Input is an ArrayBufferView; returning a copied view of the same kind preserves V.
      return cloneArrayBufferView(value) as V;
    }

    const clonedBuffer = cloneBinaryBufferValue(value);

    if (clonedBuffer !== undefined) {
      // SAFETY: Input passed ArrayBuffer/SharedArrayBuffer brand check; slicing bytes isolates it.
      return clonedBuffer as V;
    }

    if (hasGetterBrand(mapSizeGetter, value)) {
      const copy = new Map();
      seen.set(value, copy);

      for (const [entryKey, entryValue] of Map.prototype.entries.call(value)) {
        copy.set(clone(entryKey), clone(entryValue));
      }

      // SAFETY: Input passed Map brand check; returning a cloned Map preserves V.
      return copy as V;
    }

    if (hasGetterBrand(setSizeGetter, value)) {
      const copy = new Set();
      seen.set(value, copy);

      for (const entryValue of Set.prototype.values.call(value)) {
        copy.add(clone(entryValue));
      }

      // SAFETY: Input passed Set brand check; returning a cloned Set preserves V.
      return copy as V;
    }

    const clonedRegExp = cloneRegExpValue(value);

    if (clonedRegExp !== undefined) {
      // SAFETY: Input passed RegExp brand check; returning a cloned RegExp preserves V.
      return clonedRegExp as V;
    }

    if (hasGetterBrand(urlHrefGetter, value) && urlHrefGetter) {
      // SAFETY: Input passed URL brand check; returning a cloned URL preserves V.
      return new URL(String(urlHrefGetter.call(value))) as V;
    }

    const proto = Object.getPrototypeOf(value);

    if (!isBuiltInValueObject(value)) {
      // SAFETY: Creating a fresh plain object with matching prototype preserves V.
      const copy = (proto === null ? Object.create(null) : {}) as V;
      seen.set(value, copy);

      // SAFETY: Non-primitive objects are valid Object.entries targets.
      for (const [key, entry] of Object.entries(value as NonNullable<V>)) {
        Object.defineProperty(copy, key, {
          value: clone(entry),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }

      // Preserve prototype getters on class-instance metadata while still isolating mutations.
      let cursor = proto;

      while (cursor !== null && Object.getPrototypeOf(cursor) !== null) {
        for (const key of Object.getOwnPropertyNames(cursor)) {
          if (key === "constructor" || Object.prototype.hasOwnProperty.call(copy, key)) continue;

          const desc = Object.getOwnPropertyDescriptor(cursor, key);

          if (!desc?.get) continue;

          // SAFETY: Getter exists on the prototype chain of `value`.
          const entry = desc.get.call(value);

          Object.defineProperty(copy, key, {
            value: clone(entry),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }

        cursor = Object.getPrototypeOf(cursor);
      }

      return copy;
    }

    return value;
  }

  return clone(metadata);
}
