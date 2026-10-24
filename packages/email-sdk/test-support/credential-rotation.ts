import { expect } from "bun:test";
import type { EmailAdapter, EmailMessage } from "../src/types.js";
import { context, jsonCapture } from "./adapter-fixtures.js";
import type { JsonValue } from "./json.js";

type BearerOptions = {
  apiKey: string;
  headers?: Record<string, string>;
  fetch: typeof fetch;
};

/**
 * Proves a bearer-token adapter reads `apiKey` and `headers` on every send, so a rotated key,
 * an edited headers object, a replaced headers object, and a getter all reach the next request.
 */
export async function expectPerSendAuth(
  build: (options: BearerOptions) => EmailAdapter,
  message: EmailMessage,
  responseBody: JsonValue,
  responseInit?: ResponseInit,
) {
  const capture = jsonCapture(responseBody, responseInit);

  const options: BearerOptions = {
    apiKey: "key-1",
    headers: { "X-Custom": "a" },
    fetch: capture.fetch,
  };

  const adapter = build(options);

  await adapter.send(message, context);
  options.apiKey = "key-2";

  if (options.headers) options.headers["X-Custom"] = "b";

  await adapter.send(message, context);
  options.headers = { "X-Other": "c" };
  await adapter.send(message, context);

  let currentKey = "getter-1";

  const getterAdapter = build({
    get apiKey() {
      return currentKey;
    },
    fetch: capture.fetch,
  });

  await getterAdapter.send(message, context);
  currentKey = "getter-2";
  await getterAdapter.send(message, context);

  expect(capture.calls.map((call) => call.headers.get("authorization"))).toEqual([
    "Bearer key-1",
    "Bearer key-2",
    "Bearer key-2",
    "Bearer getter-1",
    "Bearer getter-2",
  ]);
  expect(capture.calls.map((call) => call.headers.get("x-custom"))).toEqual([
    "a",
    "b",
    null,
    null,
    null,
  ]);
  expect(capture.calls[2]?.headers.get("x-other")).toBe("c");
}
