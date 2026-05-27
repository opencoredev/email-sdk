import { EmailProviderError } from "./errors.js";
import type { EmailMessage, EmailProvider, EmailProviderResponse } from "./types.js";
import { httpErrorMessage, isRetryableStatus, readErrorBody } from "./utils.js";

export type JsonProviderOptions<TRaw = unknown> = {
  name: string;
  baseUrl: string;
  endpoint: string;
  headers: Record<string, string>;
  fetch?: typeof fetch;
  buildPayload: (message: EmailMessage) => unknown | Promise<unknown>;
  parseResponse?: (body: TRaw, message: EmailMessage, response: Response) => EmailProviderResponse;
};

export function jsonProvider<TRaw = Record<string, unknown>>(
  options: JsonProviderOptions<TRaw>,
): EmailProvider<{ baseUrl: string }> {
  return {
    name: options.name,
    raw: { baseUrl: options.baseUrl },
    async send(message, context) {
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
          details: body,
        });
      }

      const body = (await response.json().catch(() => ({}))) as TRaw;

      return (
        options.parseResponse?.(body, message, response) ?? {
          provider: options.name,
          raw: body,
        }
      );
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
