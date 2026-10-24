import { EmailProviderError } from "./errors.js";
import { jsonString, readJsonBody } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
import type {
  EmailAdapter,
  EmailMessage,
  EmailNativeObject,
  EmailNativePassthrough,
  EmailSendResult,
} from "./types.js";
import {
  BUILT_IN_ADAPTER_CAPABILITIES,
  httpErrorMessage,
  isRetryableStatus,
  normalizeAdapterResult,
  readErrorBody,
  validateBuiltInMessage,
  withNativeRequestHeaders,
  type AdapterRulesOption,
  type BuiltInAdapterName,
  type MessageRules,
} from "./utils.js";

type LegacyAdapterResult = Omit<EmailSendResult, "adapter"> & {
  adapter?: string;
  provider?: string;
  messageId?: string;
};

export type JsonProviderOptions<
  Name extends BuiltInAdapterName,
  TPayload extends object,
  Native extends EmailNativePassthrough = EmailNativePassthrough,
> = AdapterRulesOption<Name> & {
  name: Name;
  baseUrl: string;
  endpoint: string;
  headers: Record<string, string>;
  fetch?: typeof fetch;
  /** `native` is this adapter's entry from the send's `native` option, when one was given. */
  buildPayload: (message: EmailMessage, native: Native | undefined) => TPayload | Promise<TPayload>;
  /** Receives the parsed JSON response body, or `{}` when the body is empty or malformed. */
  parseResponse?: (
    body: JsonValue,
    message: EmailMessage,
    response: Response,
  ) => LegacyAdapterResult;
};

export function jsonProvider<
  const Name extends BuiltInAdapterName,
  TPayload extends object,
  Native extends EmailNativePassthrough & EmailNativeObject = EmailNativePassthrough,
>(
  options: JsonProviderOptions<Name, TPayload, Native>,
): EmailAdapter<Name, { baseUrl: string }, unknown, Native> {
  const rules: MessageRules | undefined = options.rules;
  const url = `${options.baseUrl}${options.endpoint}`;

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
      const native = context.native;
      const payload = await options.buildPayload(message, native);

      const headers = { "Content-Type": "application/json", ...options.headers };

      const response = await fetcher(url, {
        method: "POST",
        signal: context.signal,
        headers: native?.headers ? withNativeRequestHeaders(headers, native.headers) : headers,
        body: JSON.stringify(native?.body ? { ...payload, ...native.body } : payload),
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
