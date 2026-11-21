import { EmailProviderError, EmailValidationError } from "./errors.js";
import { isNonArrayObject, jsonString, readJsonBody } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
import type { EmailAdapter, EmailMessage } from "./types.js";
import {
  BUILT_IN_ADAPTER_CAPABILITIES,
  httpErrorDelivery,
  httpErrorMessage,
  isRetryableStatus,
  normalizeAdapterResult,
  readErrorBody,
  validateBuiltInMessage,
  type AdapterRulesOption,
  type BuiltInAdapterName,
  type LegacyEmailSendResult,
  type MessageRules,
} from "./utils.js";

export type JsonProviderOptions<
  Name extends BuiltInAdapterName,
  TPayload,
> = AdapterRulesOption<Name> & {
  name: Name;
  baseUrl: string;
  endpoint: string;
  /**
   * Request headers, built on every send. Credentials must be read inside this function, not
   * when the adapter is created, so a rotated key or a getter on the adapter options reaches the
   * next request without rebuilding the client.
   */
  headers: () => Record<string, string>;
  fetch?: typeof fetch;
  buildPayload: (message: EmailMessage) => TPayload | Promise<TPayload>;
  /** Receives the parsed JSON response body, or `{}` when the body is empty or malformed. */
  parseResponse?: (
    body: JsonValue,
    message: EmailMessage,
    response: Response,
  ) => LegacyEmailSendResult;
};

export function jsonProvider<const Name extends BuiltInAdapterName, TPayload>(
  options: JsonProviderOptions<Name, TPayload>,
): EmailAdapter<Name, { baseUrl: string }> {
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
      let safeMessage = message;

      try {
        if (isNonArrayObject(message)) {
          const rawTags = message.tags;

          if (Array.isArray(rawTags)) {
            const tags = rawTags.map((tag) =>
              isNonArrayObject(tag) ? { name: tag.name, value: tag.value } : tag,
            );

            const descriptors = Object.getOwnPropertyDescriptors(message);

            delete descriptors.tags;

            // SAFETY: preserving the original prototype and own descriptors keeps EmailMessage's shape while replacing tags with a materialized array.
            safeMessage = Object.create(Object.getPrototypeOf(message), {
              ...descriptors,
              tags: { value: tags, enumerable: true, writable: true, configurable: true },
            }) as EmailMessage;
          }
        }
      } catch (error) {
        if (error instanceof EmailValidationError) throw error;
        throw new EmailValidationError("Email message could not be read.", error);
      }

      validateBuiltInMessage(options.name, safeMessage, rules);
      const fetcher = options.fetch ?? fetch;
      const payload = await options.buildPayload(safeMessage);

      const response = await fetcher(url, {
        method: "POST",
        signal: context.signal,
        headers: {
          "Content-Type": "application/json",
          ...options.headers(),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailProviderError(httpErrorMessage(options.name, response.status, body), {
          provider: options.name,
          status: response.status,
          retryable: isRetryableStatus(response.status),
          delivery: httpErrorDelivery(response.status),
        });
      }

      const body = await readJsonBody(response);

      const result = options.parseResponse?.(body, safeMessage, response) ?? {
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
