/** A value decoded from JSON text or a JSON module import, before any schema has checked it. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
