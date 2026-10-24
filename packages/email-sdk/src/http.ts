import { EmailProviderError } from "./errors.js";
import { jsonString, readJsonBody } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
import type { EmailAdapter, EmailMessage, EmailSendResult } from "./types.js";
import {
  BUILT_IN_ADAPTER_CAPABILITIES,
  httpErrorMessage,
  isRetryableStatus,
  normalizeAdapterResult,
  readErrorBody,
  validateBuiltInMessage,
  type AdapterRulesOption,
  type BuiltInAdapterName,
  type MessageRules,
} from "./utils.js";

type LegacyAdapterResult = Omit<EmailSendResult, "adapter"> & {
  adapter?: string;
  provider?: string;
  messageId?: string;
};

export type JsonProviderOptions<Name extends BuiltInAdapterName, TPayload> = AdapterRulesOption<Name> & {
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

export function jsonProvider<const Name extends BuiltInAdapterName, TPayload>(
  options: JsonProviderOptions<Name, TPayload>,
): EmailAdapter<Name, { baseUrl: string }> {
  const rules: MessageRules | undefined = options.rules;
  const url = `${options.baseUrl}${options.endpoint}`;

  const requestHeaders = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  return {
    name: options.name,
    capabilities: BUILT_IN_ADAPTER_CAPABILITIES[options.name],
    validate(message) {
      validateBuiltInMessage(options.name, message, rules);
    },
    raw: { baseUrl: options.baseUrl },
    async send(message, context) {
      validateBuiltInMessage(options.name, message, rules);
      const fetcher = options.fetch ?? fetch;
      const payload = await options.buildPayload(message);

      const response = await fetcher(url, {
        method: "POST",
        signal: context.signal,
        // A fresh copy per request, so a fetch wrapper that edits headers cannot leak edits.
        headers: { ...requestHeaders },
        body: JSON.stringify(payload),
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
