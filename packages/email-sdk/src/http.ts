import { EmailProviderError } from "./errors.js";
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

export type JsonProviderOptions<Name extends string, TRaw = unknown> = {
  name: Name;
  baseUrl: string;
  endpoint: string;
  headers: Record<string, string>;
  fetch?: typeof fetch;
  buildPayload: (message: EmailMessage) => unknown | Promise<unknown>;
  parseResponse?: (body: TRaw, message: EmailMessage, response: Response) => LegacyAdapterResult;
};

export function jsonProvider<
  const Name extends keyof typeof SUPPORTED_MESSAGE_FIELDS,
  TRaw = Record<string, unknown>,
>(options: JsonProviderOptions<Name, TRaw>): EmailAdapter<Name, { baseUrl: string }> {
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

      const body = (await response.json().catch(() => ({}))) as TRaw;
      const result = options.parseResponse?.(body, message, response) ?? {
        adapter: options.name,
        raw: body,
      };

      return normalizeAdapterResult(options.name, result);
    },
  };
}

export function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}
