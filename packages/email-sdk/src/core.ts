import {
  EmailProviderNotFoundError,
  EmailSdkError,
  EmailValidationError,
  isRetryableEmailError,
} from "./errors.js";
import { expandRecipientMessage, recipientVariableEntries } from "./payloads.js";
import type {
  EmailAfterSendEvent,
  EmailBeforeSendEvent,
  EmailClient,
  EmailClientOptions,
  EmailErrorEvent,
  EmailHookEvent,
  EmailHooks,
  EmailMessage,
  EmailPlugin,
  EmailPluginClientExtensions,
  EmailPluginContext,
  EmailProvider,
  EmailProviderResponse,
  EmailSendMiddleware,
  SendBatchResult,
  SendOptions,
} from "./types.js";
import {
  assertMessage,
  assertRecipientVariables,
  hasRecipientVariables,
  toProviderError,
} from "./utils.js";

const defaultDelay = (attempt: number) => Math.min(100 * 2 ** (attempt - 1), 2_000);

export function createEmailClient<
  const TPlugins extends readonly EmailPlugin[] = readonly EmailPlugin[],
>(options: EmailClientOptions<TPlugins>): EmailClient<EmailPluginClientExtensions<TPlugins>> {
  const adapterList = options.adapters ?? options.providers ?? [];
  const adapters = new Map<string, EmailProvider>();
  const pluginHooks: NonNullable<EmailClientOptions["hooks"]>[] = [];
  const middleware: EmailSendMiddleware[] = [];
  const extensionPlugins: EmailPlugin[] = [];
  const requestedDefault =
    options.defaultAdapter ?? options.defaultProvider ?? adapterList[0]?.name ?? "";

  for (const adapter of adapterList) {
    addAdapter(adapters, adapter);
  }

  const pluginIds = new Set<string>();

  for (const plugin of options.plugins ?? []) {
    if (pluginIds.has(plugin.id)) {
      throw new EmailValidationError(`Duplicate email plugin "${plugin.id}".`);
    }

    pluginIds.add(plugin.id);

    const context = createPluginContext(adapters, requestedDefault);
    const pluginAdapters = resolvePluginAdapters(plugin, context);

    for (const adapter of pluginAdapters) {
      if (adapters.get(adapter.name) === adapter) {
        continue;
      }

      context.addAdapter(adapter);
    }

    if (plugin.hooks) {
      pluginHooks.push(plugin.hooks);
    }

    middleware.push(...(plugin.middleware ?? []));

    if (plugin.extendClient) {
      extensionPlugins.push(plugin);
    }
  }

  const firstAdapter = adapters.keys().next().value;
  const defaultProvider = options.defaultAdapter ?? options.defaultProvider ?? firstAdapter;

  if (!defaultProvider) {
    throw new EmailValidationError("createEmailClient requires a default adapter.");
  }

  if (!adapters.has(defaultProvider)) {
    throw new EmailProviderNotFoundError(defaultProvider);
  }

  const hooks = [...pluginHooks, ...(options.hooks ? [options.hooks] : [])];
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
          hookList: hooks,
          middleware,
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
        const resolvedAdapter =
          adapter ?? provider ?? sendOptions?.adapter ?? sendOptions?.provider;
        const resolvedFallbackAdapters =
          fallbackAdapters ??
          fallbackProviders ??
          sendOptions?.fallbackAdapters ??
          sendOptions?.fallbackProviders;

        try {
          const response = await client.send(message, {
            ...sendOptions,
            adapter: resolvedAdapter,
            provider: undefined,
            fallbackAdapters: resolvedFallbackAdapters,
            fallbackProviders: undefined,
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

  for (const plugin of extensionPlugins) {
    applyClientExtension(
      client,
      plugin.id,
      plugin.extendClient?.(createPluginContext(adapters, defaultProvider)) ?? {},
    );
  }

  return client as EmailClient<EmailPluginClientExtensions<TPlugins>>;
}

async function sendWithAdapters(input: {
  adapters: Map<string, EmailProvider>;
  message: EmailMessage;
  options: Pick<EmailClientOptions, "retry"> & {
    hookList: NonNullable<EmailClientOptions["hooks"]>[];
    middleware: EmailSendMiddleware[];
    defaultProvider: string;
    fallback?: string[];
  };
  sendOptions?: SendOptions;
}): Promise<EmailProviderResponse> {
  const prepared = await applyBeforeSendMiddleware(input.options.middleware, {
    message: input.message,
    options: input.sendOptions,
  });

  assertMessage(prepared.message);
  assertRecipientVariables(prepared.message);

  const adapterNames = resolveAdapterOrder({
    adapter:
      prepared.options?.adapter ?? prepared.options?.provider ?? input.options.defaultProvider,
    fallbackAdapters:
      prepared.options?.fallbackAdapters ??
      prepared.options?.fallbackProviders ??
      input.options.fallback,
  });

  const failures: unknown[] = [];

  for (const adapterName of adapterNames) {
    const provider = input.adapters.get(adapterName);

    if (!provider) {
      throw new EmailProviderNotFoundError(adapterName);
    }

    try {
      return await attemptProvider({
        provider,
        message: prepared.message,
        hookList: input.options.hookList,
        middleware: input.options.middleware,
        retry: {
          ...input.options.retry,
          retries: prepared.options?.retries ?? input.options.retry?.retries,
        },
        sendOptions: prepared.options,
      });
    } catch (error) {
      const failure = unwrapProviderAttemptFailure(error);
      failures.push(failure.error);
      await invokeErrorHooks(input.options.middleware, input.options.hookList, {
        provider: provider.name,
        message: prepared.message,
        attempt: failure.attempt,
        metadata: prepared.options?.metadata,
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

type ProviderAttempt = {
  provider: EmailProvider;
  message: EmailMessage;
  hookList: NonNullable<EmailClientOptions["hooks"]>[];
  middleware: EmailSendMiddleware[];
  retry: EmailClientOptions["retry"];
  sendOptions?: SendOptions;
};

function attemptProvider(input: ProviderAttempt): Promise<EmailProviderResponse> {
  if (hasRecipientVariables(input.message)) {
    return input.provider.sendBulk
      ? sendWithRetry({ ...input, perform: input.provider.sendBulk })
      : sendBulkViaFallback(input);
  }

  return sendWithRetry(input);
}

async function sendBulkViaFallback(input: ProviderAttempt): Promise<EmailProviderResponse> {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const responses: EmailProviderResponse[] = [];
  const failures: unknown[] = [];

  for (const entry of recipientVariableEntries(input.message)) {
    const message = expandRecipientMessage(input.message, entry);

    try {
      const response = await sendWithRetry({
        provider: input.provider,
        message,
        hookList: input.hookList,
        middleware: input.middleware,
        retry: input.retry,
        sendOptions: withRecipientIdempotencyKey(input.sendOptions, input.message, entry.address),
      });
      responses.push(response);
      accepted.push(entry.address);
    } catch (error) {
      const failure = unwrapProviderAttemptFailure(error);
      rejected.push(entry.address);
      failures.push(failure.error);
      await invokeErrorHooks(input.middleware, input.hookList, {
        provider: input.provider.name,
        message,
        attempt: failure.attempt,
        metadata: input.sendOptions?.metadata,
        error: failure.error,
      });
    }
  }

  if (accepted.length === 0) {
    throw new ProviderAttemptFailure(
      failures.length === 1
        ? failures[0]
        : new EmailSdkError("All batch recipients failed.", {
            code: "all_recipients_failed",
            retryable: false,
            details: failures,
          }),
      1,
    );
  }

  return {
    provider: input.provider.name,
    accepted,
    rejected: rejected.length > 0 ? rejected : undefined,
    raw: responses,
  };
}

function withRecipientIdempotencyKey(
  sendOptions: SendOptions | undefined,
  message: EmailMessage,
  address: string,
): SendOptions | undefined {
  const base = sendOptions?.idempotencyKey ?? message.idempotencyKey;

  if (!base) {
    return sendOptions;
  }

  return { ...sendOptions, idempotencyKey: `${base}:${address}` };
}

async function sendWithRetry(input: ProviderAttempt & { perform?: EmailProvider["send"] }) {
  const retries = input.retry?.retries ?? 0;
  const shouldRetry = input.retry?.shouldRetry ?? isRetryableEmailError;
  const delayFor = input.retry?.delay ?? defaultDelay;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    await invokeHooks(input.hookList, "beforeSend", {
      provider: input.provider.name,
      message: input.message,
      attempt,
      metadata: input.sendOptions?.metadata,
    });

    try {
      const context = {
        signal: input.sendOptions?.signal,
        idempotencyKey: input.sendOptions?.idempotencyKey ?? input.message.idempotencyKey,
        attempt,
        metadata: input.sendOptions?.metadata,
      };
      const response = input.perform
        ? await input.perform(input.message, context)
        : await input.provider.send(input.message, context);

      const normalizedResponse = {
        ...response,
        provider: response.provider || input.provider.name,
      };

      const afterEvent = {
        provider: input.provider.name,
        message: input.message,
        attempt,
        metadata: input.sendOptions?.metadata,
        response: normalizedResponse,
      };

      await invokeAfterSendMiddleware(input.middleware, afterEvent);
      await invokeHooks(input.hookList, "afterSend", afterEvent);

      return normalizedResponse;
    } catch (error) {
      const normalizedError = toProviderError(input.provider.name, error);
      const canRetry = attempt <= retries && shouldRetry(normalizedError, attempt);

      if (!canRetry) {
        throw new ProviderAttemptFailure(normalizedError, attempt);
      }

      const delayMs = delayFor(attempt, normalizedError);

      await invokeHooks(input.hookList, "onRetry", {
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

function addAdapter(adapters: Map<string, EmailProvider>, adapter: EmailProvider) {
  if (adapters.has(adapter.name)) {
    throw new EmailValidationError(`Duplicate email adapter "${adapter.name}".`);
  }

  adapters.set(adapter.name, adapter);
}

function createPluginContext(
  adapters: Map<string, EmailProvider>,
  requestedDefault: string,
): EmailPluginContext {
  return {
    adapters,
    get defaultAdapter() {
      return requestedDefault;
    },
    addAdapter(adapter) {
      addAdapter(adapters, adapter);
    },
  };
}

function resolvePluginAdapters(plugin: EmailPlugin, context: EmailPluginContext): EmailProvider[] {
  if (!plugin.adapters) {
    return [];
  }

  const adapters = Array.isArray(plugin.adapters) ? plugin.adapters : plugin.adapters(context);

  if (isThenable(adapters)) {
    throw new EmailValidationError(
      `Email plugin "${plugin.id}" returned async adapters. createEmailClient requires synchronous plugin adapters.`,
    );
  }

  return adapters;
}

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return Boolean(value && typeof (value as Promise<T>).then === "function");
}

function applyClientExtension(client: EmailClient, pluginId: string, extension: object) {
  for (const key of Object.keys(extension)) {
    if (Object.hasOwn(client, key)) {
      throw new EmailValidationError(
        `Email plugin "${pluginId}" tried to extend the client with reserved key "${key}".`,
      );
    }
  }

  Object.assign(client, extension);
}

async function applyBeforeSendMiddleware(
  middleware: EmailSendMiddleware[],
  event: EmailBeforeSendEvent,
): Promise<
  Required<Pick<EmailBeforeSendEvent, "message">> & Pick<EmailBeforeSendEvent, "options">
> {
  let message = event.message;
  let options = event.options;

  for (const item of middleware) {
    const result = await item.beforeSend?.({ message, options });

    if (result?.message) {
      message = result.message;
    }

    if (result?.options) {
      options = { ...options, ...result.options };
    }
  }

  return { message, options };
}

async function invokeAfterSendMiddleware(
  middleware: EmailSendMiddleware[],
  event: EmailAfterSendEvent,
) {
  for (const item of middleware) {
    await invokeHook(item.afterSend, event);
  }
}

async function invokeErrorMiddleware(middleware: EmailSendMiddleware[], event: EmailErrorEvent) {
  for (const item of middleware) {
    await invokeHook(item.onError, event);
  }
}

async function invokeErrorHooks(
  middleware: EmailSendMiddleware[],
  hookList: NonNullable<EmailClientOptions["hooks"]>[],
  event: EmailErrorEvent,
) {
  await invokeErrorMiddleware(middleware, event);
  await invokeHooks(hookList, "onError", event);
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

type EmailRetryHookEvent = EmailHookEvent & {
  error: unknown;
  nextAttempt: number;
  delayMs: number;
};

type EmailHookPayload =
  | EmailHookEvent
  | EmailAfterSendEvent
  | EmailErrorEvent
  | EmailRetryHookEvent;

async function invokeHooks(
  hookList: NonNullable<EmailClientOptions["hooks"]>[],
  name: keyof EmailHooks,
  event: EmailHookPayload,
) {
  for (const hooks of hookList) {
    await invokeHook(
      hooks[name] as ((event: EmailHookPayload) => unknown | Promise<unknown>) | undefined,
      event,
    );
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
