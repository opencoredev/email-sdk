import { EmailAdapterError, EmailAdapterNotFoundError, EmailValidationError } from "../errors.js";
import type {
  EmailAdapter,
  EmailFallbackConfig,
  EmailMessage,
  EmailRetryConfig,
  EmailSendOptions,
} from "../types.js";

export function validateCapabilities(
  adapter: EmailAdapter,
  message: EmailMessage,
  operation: "send" | "personalized",
) {
  if (message.sendAt !== undefined && !adapter.capabilities.scheduling) {
    throw new EmailValidationError(`${adapter.name} does not support scheduled email.`);
  }

  if (operation === "personalized" && adapter.capabilities.personalized === "unsupported") {
    throw new EmailValidationError(`${adapter.name} does not support personalized email.`);
  }

  if (!adapter.capabilities.repeatedHeaders) {
    const names = new Set<string>();

    for (const header of message.headers ?? []) {
      const normalized = header.name.toLowerCase();

      if (names.has(normalized)) {
        throw new EmailValidationError(
          `${adapter.name} does not support repeated email header names: ${header.name}.`,
        );
      }

      names.add(normalized);
    }
  }
}

export function resolveRoute(
  defaultAdapter: string,
  clientFallback: EmailFallbackConfig | undefined,
  sendOptions: EmailSendOptions | undefined,
) {
  const primary = sendOptions?.adapter ?? defaultAdapter;
  const fallback = sendOptions?.fallback ?? clientFallback;

  return {
    primary,
    fallback,
    names: [primary, ...(fallback?.adapters ?? []).filter((name) => name !== primary)],
  };
}

export function canFallback(error: EmailAdapterError, fallback: EmailFallbackConfig | undefined) {
  return error.delivery === "not_sent" || fallback?.onUnknownDelivery === "continue";
}

export function validateRetry(retry: EmailRetryConfig | undefined) {
  if (
    retry?.maxAttempts !== undefined &&
    (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1)
  ) {
    throw new EmailValidationError(
      "retry.maxAttempts must be an integer greater than or equal to 1.",
    );
  }
}

export function validateFallback(
  adapters: ReadonlyMap<string, EmailAdapter>,
  fallback: EmailFallbackConfig | undefined,
) {
  for (const name of fallback?.adapters ?? []) requireAdapter(adapters, name);
}

export function mergeSendOptions(
  base: EmailSendOptions | undefined,
  override: EmailSendOptions | undefined,
): EmailSendOptions | undefined {
  if (!base) return override;

  if (!override) return base;

  return { ...base, ...override };
}

export function requireAdapter(adapters: ReadonlyMap<string, EmailAdapter>, name: string) {
  const adapter = adapters.get(name);

  if (!adapter) throw new EmailAdapterNotFoundError(name);

  return adapter;
}

export function addAdapter(adapters: Map<string, EmailAdapter>, adapter: EmailAdapter) {
  if (adapters.has(adapter.name)) {
    throw new EmailValidationError(`Duplicate email adapter "${adapter.name}".`);
  }

  adapters.set(adapter.name, adapter);
}
