import {
  EmailAdapterError,
  EmailAdapterNotFoundError,
  EmailSdkError,
  EmailValidationError,
} from "../errors.js";
import {
  cloneMetadataRecord,
  isFunction,
  isNonArrayObject,
  isStringMember,
} from "../internal/decode.js";
import { copyBoundedArray } from "../internal/snapshot.js";
import { headerList } from "../utils.js";
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
  sendOptions?: Pick<EmailSendOptions, "idempotencyKey" | "idempotency">,
) {
  try {
    if (!isNonArrayObject(adapter.capabilities)) {
      throw new EmailAdapterError(`Adapter "${adapter.name}" is missing capabilities.`, {
        adapter: adapter.name,
        delivery: "not_sent",
        retryable: false,
      });
    }

    if (message.sendAt !== undefined && !adapter.capabilities.scheduling) {
      throw new EmailValidationError(`${adapter.name} does not support scheduled email.`);
    }

    if (
      sendOptions?.idempotency !== undefined &&
      sendOptions.idempotency !== "strict" &&
      sendOptions.idempotency !== "best-effort"
    ) {
      throw new EmailValidationError('idempotency must be "strict" or "best-effort".');
    }

    // An idempotency key is a safety promise: a retried or replayed send is delivered once. An
    // adapter that cannot keep that promise fails loudly instead of silently dropping the key.
    if (sendOptions?.idempotencyKey !== undefined) {
      if (
        !isStringMember(sendOptions.idempotencyKey) ||
        sendOptions.idempotencyKey.trim().length === 0
      ) {
        throw new EmailValidationError("idempotencyKey must be a non-empty string.");
      }

      if (sendOptions.idempotency !== "best-effort" && adapter.capabilities.idempotency === "none") {
        throw new EmailValidationError(
          `${adapter.name} cannot deduplicate sends, so idempotencyKey would be ignored. Route to an adapter with idempotency support, remove idempotencyKey, or pass idempotency: "best-effort" to send without provider deduplication.`,
          { adapter: adapter.name, capability: "idempotency" },
        );
      }
    }

    if (operation === "personalized" && adapter.capabilities.personalized === "unsupported") {
      throw new EmailValidationError(`${adapter.name} does not support personalized email.`);
    }

    // headerList also accepts the legacy name-to-value object that JavaScript callers send.
    const headers = headerList(message.headers);

    if (!adapter.capabilities.repeatedHeaders && headers.length > 1) {
      const names = new Set<string>();

      for (const header of headers) {
        const normalized = header.name.toLowerCase();

        if (names.has(normalized)) {
          throw new EmailValidationError(
            `${adapter.name} does not support repeated email header names: ${header.name}.`,
          );
        }

        names.add(normalized);
      }
    }
  } catch (error) {
    if (error instanceof EmailSdkError) throw error;

    throw new EmailValidationError("Email message or send options could not be read.", error);
  }
}

export type EmailRoute = {
  primary: string;
  fallback: EmailFallbackConfig | undefined;
  names: readonly string[];
};

export function resolveRoute(
  defaultAdapter: string,
  clientFallback: EmailFallbackConfig | undefined,
  sendOptions: EmailSendOptions | undefined,
): EmailRoute {
  const primary = sendOptions?.adapter ?? defaultAdapter;
  const fallback = sendOptions?.fallback ?? clientFallback;

  if (fallback !== undefined && !isNonArrayObject(fallback)) {
    throw new EmailValidationError("fallback must be an object.");
  }

  if (fallback?.adapters !== undefined && !Array.isArray(fallback.adapters)) {
    throw new EmailValidationError("fallback.adapters must be an array of adapter names.");
  }

  if (!fallback?.adapters) return { primary, fallback, names: [primary] };

  const fallbackAdapters = copyBoundedArray(fallback.adapters, "fallback.adapters");

  if (!fallbackAdapters.length) return { primary, fallback, names: [primary] };

  return {
    primary,
    fallback,
    // A Set keeps first occurrences in order, so a repeated name is attempted once.
    names: [...new Set([primary, ...fallbackAdapters])],
  };
}

export function canFallback(error: EmailAdapterError, fallback: EmailFallbackConfig | undefined) {
  return error.delivery === "not_sent" || fallback?.onUnknownDelivery === "continue";
}

export function snapshotRetryConfig(retry: EmailRetryConfig | undefined): EmailRetryConfig | undefined {
  if (retry === undefined) return undefined;

  if (!isNonArrayObject(retry)) {
    throw new EmailValidationError("retry must be an object.");
  }

  const snapshot: EmailRetryConfig = {};

  if ("maxAttempts" in retry) snapshot.maxAttempts = retry.maxAttempts;

  if ("delay" in retry) {
    const delay = retry.delay;

    if (isFunction(delay)) {
      // SAFETY: `delay` is a verified EmailRetryConfig delay function; binding preserves its type.
      snapshot.delay = Function.prototype.bind.call(delay, retry) as EmailRetryConfig["delay"];
    } else {
      snapshot.delay = delay;
    }
  }

  if ("shouldRetry" in retry) {
    const shouldRetry = retry.shouldRetry;

    if (isFunction(shouldRetry)) {
      // SAFETY: `shouldRetry` is a verified EmailRetryConfig predicate; binding preserves its type.
      snapshot.shouldRetry = Function.prototype.bind.call(
        shouldRetry,
        retry,
      ) as EmailRetryConfig["shouldRetry"];
    } else {
      snapshot.shouldRetry = shouldRetry;
    }
  }

  return snapshot;
}

export function snapshotFallbackConfig<Name extends string = string>(
  fallback: EmailFallbackConfig<Name> | undefined,
): EmailFallbackConfig<Name> | undefined {
  if (fallback === undefined) return undefined;

  if (!isNonArrayObject(fallback)) {
    throw new EmailValidationError("fallback must be an object.");
  }

  const rawAdapters = "adapters" in fallback ? fallback.adapters : undefined;

  // SAFETY: Preserves caller's runtime non-array/missing adapters for validateFallback to reject.
  const adapters = Array.isArray(rawAdapters)
    ? copyBoundedArray(rawAdapters, "fallback.adapters")
    : (rawAdapters as readonly Name[]);

  const snapshot: EmailFallbackConfig<Name> = { adapters };

  if ("onUnknownDelivery" in fallback) {
    snapshot.onUnknownDelivery = fallback.onUnknownDelivery;
  }

  return snapshot;
}

export function validateRetry(retry: EmailRetryConfig | undefined) {
  if (retry !== undefined && !isNonArrayObject(retry)) {
    throw new EmailValidationError("retry must be an object.");
  }

  if (!retry) return;

  const maxAttempts = retry.maxAttempts;

  if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1)) {
    throw new EmailValidationError(
      "retry.maxAttempts must be an integer greater than or equal to 1.",
    );
  }

  const delay = retry.delay;

  if (delay !== undefined && !isFunction(delay)) {
    throw new EmailValidationError("retry.delay must be a function.");
  }

  const shouldRetry = retry.shouldRetry;

  if (shouldRetry !== undefined && !isFunction(shouldRetry)) {
    throw new EmailValidationError("retry.shouldRetry must be a function.");
  }
}

export function validateFallback(
  adapters: ReadonlyMap<string, EmailAdapter>,
  fallback: EmailFallbackConfig | undefined,
) {
  if (fallback !== undefined && !isNonArrayObject(fallback)) {
    throw new EmailValidationError("fallback must be an object.");
  }

  if (!fallback) return;

  const list = fallback.adapters;

  if (list !== undefined && !Array.isArray(list)) {
    throw new EmailValidationError("fallback.adapters must be an array of adapter names.");
  }

  const onUnknownDelivery = fallback.onUnknownDelivery;

  if (
    onUnknownDelivery !== undefined &&
    onUnknownDelivery !== "stop" &&
    onUnknownDelivery !== "continue"
  ) {
    throw new EmailValidationError('fallback.onUnknownDelivery must be "stop" or "continue".');
  }

  for (const name of list ?? []) requireAdapter(adapters, name);
}

/**
 * Copies send options, keeping an own key whose value is `undefined`: spreading the copy over
 * batch or middleware options must still clear that setting, as spreading the raw object did.
 */
export function cloneNestedSendOptions(options: EmailSendOptions): EmailSendOptions {
  const copy: EmailSendOptions = {};

  const present = (key: keyof EmailSendOptions, value: EmailSendOptions[keyof EmailSendOptions]) =>
    value !== undefined || Object.hasOwn(options, key);

  const adapter = options.adapter;

  if (present("adapter", adapter)) copy.adapter = adapter;

  const idempotencyKey = options.idempotencyKey;

  if (present("idempotencyKey", idempotencyKey)) copy.idempotencyKey = idempotencyKey;

  const idempotency = options.idempotency;

  if (present("idempotency", idempotency)) copy.idempotency = idempotency;

  const signal = options.signal;

  if (present("signal", signal)) copy.signal = signal;

  const retry = options.retry;

  if (present("retry", retry)) {
    copy.retry = isNonArrayObject(retry) ? snapshotRetryConfig(retry) : retry;
  }

  const fallback = options.fallback;

  if (present("fallback", fallback)) {
    copy.fallback = isNonArrayObject(fallback) ? snapshotFallbackConfig(fallback) : fallback;
  }

  const metadata = options.metadata;

  if (present("metadata", metadata)) {
    copy.metadata = isNonArrayObject(metadata) ? cloneMetadataRecord(metadata) : metadata;
  }

  return copy;
}

/**
 * Item options over `sendMany` method options. `retry` and `fallback` merge one level deep, so an
 * item that sets only `retry.delay` keeps the batch's `retry.maxAttempts`; `fallback.adapters`
 * from the item still replaces the batch list as a whole.
 */
export function mergeSendOptions(
  base: EmailSendOptions | undefined,
  override: EmailSendOptions | undefined,
): EmailSendOptions | undefined {
  if (!base) return override ? cloneNestedSendOptions(override) : undefined;

  if (!override) return cloneNestedSendOptions(base);

  base = cloneNestedSendOptions(base);
  override = cloneNestedSendOptions(override);

  const merged: EmailSendOptions = { ...base, ...override };

  if (override.idempotencyKey === undefined && base.idempotencyKey !== undefined) {
    merged.idempotencyKey = base.idempotencyKey;
  }

  if (
    base.retry &&
    override.retry &&
    isNonArrayObject(base.retry) &&
    isNonArrayObject(override.retry)
  ) {
    merged.retry = { ...base.retry, ...override.retry };
  } else if (merged.retry && isNonArrayObject(merged.retry)) {
    merged.retry = { ...merged.retry };
  }

  if (
    base.fallback &&
    override.fallback &&
    isNonArrayObject(base.fallback) &&
    isNonArrayObject(override.fallback)
  ) {
    merged.fallback = {
      ...base.fallback,
      ...override.fallback,
      adapters: Array.isArray(override.fallback.adapters)
        ? [...override.fallback.adapters]
        : override.fallback.adapters !== undefined
          ? override.fallback.adapters
          : Array.isArray(base.fallback.adapters)
            ? [...base.fallback.adapters]
            : base.fallback.adapters,
    };
  } else if (merged.fallback && isNonArrayObject(merged.fallback)) {
    merged.fallback = {
      ...merged.fallback,
      adapters: Array.isArray(merged.fallback.adapters)
        ? [...merged.fallback.adapters]
        : merged.fallback.adapters,
    };
  }

  if (merged.metadata && isNonArrayObject(merged.metadata)) {
    merged.metadata = cloneMetadataRecord(merged.metadata);
  }

  return merged;
}

export function requireAdapter(adapters: ReadonlyMap<string, EmailAdapter>, name: string) {
  if (!isStringMember(name)) {
    throw new EmailValidationError("Email adapter name must be a string.");
  }

  const adapter = adapters.get(name);

  if (!adapter) throw new EmailAdapterNotFoundError(name);

  return adapter;
}

export function addAdapter(adapters: Map<string, EmailAdapter>, adapter: EmailAdapter) {
  if (!isNonArrayObject(adapter) || !isStringMember(adapter.name) || !adapter.name.trim()) {
    throw new EmailValidationError("Each email adapter must be an object with a non-empty name.");
  }

  if (adapters.has(adapter.name)) {
    throw new EmailValidationError(`Duplicate email adapter "${adapter.name}".`);
  }

  adapters.set(adapter.name, adapter);
}
