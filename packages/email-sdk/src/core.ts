import {
  EmailProviderNotFoundError,
  EmailSdkError,
  EmailValidationError,
  isRetryableEmailError,
} from "./errors.js";
import type {
  EmailClient,
  EmailClientOptions,
  EmailMessage,
  EmailProvider,
  EmailProviderResponse,
  SendBatchResult,
  SendOptions,
} from "./types.js";
import { assertMessage, toProviderError } from "./utils.js";

const defaultDelay = (attempt: number) => Math.min(100 * 2 ** (attempt - 1), 2_000);

export function createEmailClient(options: EmailClientOptions): EmailClient {
  const adapterList = options.adapters ?? options.providers ?? [];

  if (adapterList.length === 0) {
    throw new EmailValidationError("createEmailClient requires at least one adapter.");
  }

  const adapters = new Map<string, EmailProvider>();

  for (const adapter of adapterList) {
    if (adapters.has(adapter.name)) {
      throw new EmailValidationError(`Duplicate email adapter "${adapter.name}".`);
    }

    adapters.set(adapter.name, adapter);
  }

  const defaultProvider = options.defaultAdapter ?? options.defaultProvider ?? adapterList[0]?.name;

  if (!defaultProvider) {
    throw new EmailValidationError("createEmailClient requires a default adapter.");
  }

  if (!adapters.has(defaultProvider)) {
    throw new EmailProviderNotFoundError(defaultProvider);
  }

  const client: EmailClient = {
    adapters,
    providers: adapters,
    defaultAdapter: defaultProvider,
    defaultProvider,
    adapter<TProvider extends EmailProvider = EmailProvider>(name: string) {
      const provider = adapters.get(name);

      if (!provider) {
        throw new EmailProviderNotFoundError(name);
      }

      return provider as TProvider;
    },
    provider<TProvider extends EmailProvider = EmailProvider>(name: string) {
      return client.adapter<TProvider>(name);
    },
    async send(message, sendOptions) {
      return sendWithAdapters({
        adapters,
        message,
        options: {
          hooks: options.hooks,
          retry: options.retry,
          defaultProvider,
          fallback: options.fallback,
        },
        sendOptions,
      });
    },
    async sendBatch(messages, sendOptions) {
      const results: SendBatchResult[] = [];

      for (const [index, item] of messages.entries()) {
        const { adapter, provider, fallbackAdapters, fallbackProviders, ...message } = item;

        try {
          const response = await client.send(message, {
            ...sendOptions,
            adapter: adapter ?? sendOptions?.adapter,
            provider: provider ?? sendOptions?.provider,
            fallbackAdapters:
              fallbackAdapters ??
              sendOptions?.fallbackAdapters ??
              fallbackProviders ??
              sendOptions?.fallbackProviders,
          });
          results.push({ ok: true, index, response });
        } catch (error) {
          results.push({ ok: false, index, error });
        }
      }

      return results;
    },
    withAdapter(name) {
      client.adapter(name);

      return {
        send(message, sendOptions) {
          return client.send(message, { ...sendOptions, adapter: name });
        },
        sendBatch(messages, sendOptions) {
          return client.sendBatch(messages, { ...sendOptions, adapter: name });
        },
      };
    },
    withProvider(name) {
      return client.withAdapter(name);
    },
  };

  return client;
}

async function sendWithAdapters(input: {
  adapters: Map<string, EmailProvider>;
  message: EmailMessage;
  options: Pick<EmailClientOptions, "hooks" | "retry"> & {
    defaultProvider: string;
    fallback?: string[];
  };
  sendOptions?: SendOptions;
}): Promise<EmailProviderResponse> {
  assertMessage(input.message);

  const adapterNames = resolveAdapterOrder({
    adapter:
      input.sendOptions?.adapter ?? input.sendOptions?.provider ?? input.options.defaultProvider,
    fallbackAdapters:
      input.sendOptions?.fallbackAdapters ??
      input.sendOptions?.fallbackProviders ??
      input.options.fallback,
  });

  const failures: unknown[] = [];

  for (const adapterName of adapterNames) {
    const provider = input.adapters.get(adapterName);

    if (!provider) {
      throw new EmailProviderNotFoundError(adapterName);
    }

    try {
      return await sendWithRetry({
        provider,
        message: input.message,
        hooks: input.options.hooks,
        retry: {
          ...input.options.retry,
          retries: input.sendOptions?.retries ?? input.options.retry?.retries,
        },
        sendOptions: input.sendOptions,
      });
    } catch (error) {
      const failure = unwrapProviderAttemptFailure(error);
      failures.push(failure.error);
      await invokeHook(input.options.hooks?.onError, {
        provider: provider.name,
        message: input.message,
        attempt: failure.attempt,
        metadata: input.sendOptions?.metadata,
        error: failure.error,
      });
    }
  }

  if (failures.length === 1) {
    throw failures[0];
  }

  throw new EmailSdkError("All email adapters failed.", {
    code: "all_providers_failed",
    retryable: false,
    details: failures,
  });
}

async function sendWithRetry(input: {
  provider: EmailProvider;
  message: EmailMessage;
  hooks: EmailClientOptions["hooks"];
  retry: EmailClientOptions["retry"];
  sendOptions?: SendOptions;
}) {
  const retries = input.retry?.retries ?? 0;
  const shouldRetry = input.retry?.shouldRetry ?? isRetryableEmailError;
  const delayFor = input.retry?.delay ?? defaultDelay;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    await invokeHook(input.hooks?.beforeSend, {
      provider: input.provider.name,
      message: input.message,
      attempt,
      metadata: input.sendOptions?.metadata,
    });

    try {
      const response = await input.provider.send(input.message, {
        signal: input.sendOptions?.signal,
        idempotencyKey: input.sendOptions?.idempotencyKey ?? input.message.idempotencyKey,
        attempt,
        metadata: input.sendOptions?.metadata,
      });

      const normalizedResponse = {
        ...response,
        provider: response.provider || input.provider.name,
      };

      await invokeHook(input.hooks?.afterSend, {
        provider: input.provider.name,
        message: input.message,
        attempt,
        metadata: input.sendOptions?.metadata,
        response: normalizedResponse,
      });

      return normalizedResponse;
    } catch (error) {
      const normalizedError = toProviderError(input.provider.name, error);
      const canRetry = attempt <= retries && shouldRetry(normalizedError, attempt);

      if (!canRetry) {
        throw new ProviderAttemptFailure(normalizedError, attempt);
      }

      const delayMs = delayFor(attempt, normalizedError);

      await invokeHook(input.hooks?.onRetry, {
        provider: input.provider.name,
        message: input.message,
        attempt,
        metadata: input.sendOptions?.metadata,
        error: normalizedError,
        nextAttempt: attempt + 1,
        delayMs,
      });

      await sleep(delayMs);
    }
  }

  throw new EmailSdkError("Email retry loop exited unexpectedly.", {
    code: "retry_loop_exited",
    retryable: false,
  });
}

class ProviderAttemptFailure {
  constructor(
    readonly error: unknown,
    readonly attempt: number,
  ) {}
}

function unwrapProviderAttemptFailure(error: unknown) {
  if (error instanceof ProviderAttemptFailure) {
    return error;
  }

  return new ProviderAttemptFailure(error, 1);
}

async function invokeHook<T>(
  hook: ((event: T) => unknown | Promise<unknown>) | undefined,
  event: T,
) {
  try {
    await hook?.(event);
  } catch {
    // Hooks are observability callbacks. Provider behavior should not be masked by hook failures.
  }
}

function resolveAdapterOrder(input: { adapter: string; fallbackAdapters?: string[] }) {
  return [input.adapter, ...(input.fallbackAdapters ?? [])].filter((adapter, index, adapters) => {
    return adapters.indexOf(adapter) === index;
  });
}

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}
