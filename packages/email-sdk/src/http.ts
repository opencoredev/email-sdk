import { EmailProviderError } from "./errors.js";
import { jsonString, readJsonBody } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
import type { EmailAdapter, EmailMessage, EmailSendResult } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  builtInAdapterDefinition,
  httpErrorMessage,
  isRetryableStatus,
  normalizeAdapterResult,
  readErrorBody,
  validateBuiltInAdapter,
} from "./utils.js";

type LegacyAdapterResult = Omit<EmailSendResult, "adapter"> & {
  adapter?: string;
  provider?: string;
  messageId?: string;
};

export type JsonProviderOptions<Name extends string, TPayload> = {
  name: Name;
  baseUrl: string;
  endpoint: string;
  headers: Record<string, string>;
  fetch?: typeof fetch;
  buildPayload: (message: EmailMessage) => TPayload | Promise<TPayload>;
  /** Receives the parsed JSON response body, or `{}` when the body is empty or malformed. */
  parseResponse?: (
    body: JsonValue,
    message: EmailMessage,
    response: Response,
  ) => LegacyAdapterResult;
};

export function jsonProvider<
  const Name extends keyof typeof SUPPORTED_MESSAGE_FIELDS,
  TPayload,
>(options: JsonProviderOptions<Name, TPayload>): EmailAdapter<Name, { baseUrl: string }> {
  return {
    name: options.name,
    ...builtInAdapterDefinition(options.name),
    raw: { baseUrl: options.baseUrl },
    async send(message, context) {
      validateBuiltInAdapter(options.name, message);
      const fetcher = options.fetch ?? fetch;

      const response = await fetcher(`${options.baseUrl}${options.endpoint}`, {
        method: "POST",
        signal: context.signal,
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        body: JSON.stringify(await options.buildPayload(message)),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailProviderError(httpErrorMessage(options.name, response.status, body), {
          provider: options.name,
          status: response.status,
          retryable: isRetryableStatus(response.status),
          delivery: "unknown",
        });
      }

      const body = await readJsonBody(response);

      const result = options.parseResponse?.(body, message, response) ?? {
        adapter: options.name,
        raw: body,
      };

      return normalizeAdapterResult(options.name, result);
    },
  };
}

/** Return the first of `keys` whose value on a JSON object is a string. */
export function firstString(record: JsonValue | undefined, keys: readonly string[]) {
  for (const key of keys) {
    const value = jsonString(record, key);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}
