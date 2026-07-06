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
  getTelemetry,
  getTelemetrySource,
  isReportableSendError,
  normalizeAdapterName,
} from "./telemetry.js";
import {
  arrayify,
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

  const telemetry = options.telemetry === false ? undefined : getTelemetry();
  const telemetrySource = getTelemetrySource();

  void telemetry?.capture("client created", {
    adapters: [...adapters.keys()].map(normalizeAdapterName),
    adapter_count: adapters.size,
    plugin_count: options.plugins?.length ?? 0,
    default_adapter: normalizeAdapterName(defaultProvider),
    source: telemetrySource,
  });

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
      const startedAt = Date.now();
      // Facts are read from the caller's message, before middleware runs, so the
      // event describes what the user asked for. Only one "email sent" event fires
      // per send() call: expanded per-recipient fallback sends run through
      // sendWithRetry internally and are never counted individually.
      const usedRecipientVariables = hasRecipientVariables(message);
      const messageFacts = {
        recipients:
          arrayify(message.to).length + arrayify(message.cc).length + arrayify(message.bcc).length,
        has_attachments: (message.attachments?.length ?? 0) > 0,
        used_recipient_variables: usedRecipientVariables,
        used_send_at: message.sendAt !== undefined,
      };

      try {
        const response = await sendWithAdapters({
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

        void telemetry?.capture("email sent", {
          ...messageFacts,
          adapter: normalizeAdapterName(response.provider),
          delivery_path: deliveryPath(usedRecipientVariables, adapters.get(response.provider)),
          success: true,
          duration_ms: Date.now() - startedAt,
          source: telemetrySource,
        });

        return response;
      } catch (error) {
        const failedAdapterName =
          sendOptions?.adapter ?? sendOptions?.provider ?? defaultProvider;
        const failedAdapter = normalizeAdapterName(failedAdapterName);

        void telemetry?.capture("email sent", {
          ...messageFacts,
          adapter: failedAdapter,
          // On failure the primary adapter decides the path — the one that would
          // have delivered had the send succeeded.
          delivery_path: deliveryPath(usedRecipientVariables, adapters.get(failedAdapterName)),
          success: false,
          duration_ms: Date.now() - startedAt,
          error_code: error instanceof EmailSdkError ? error.code : "unknown",
          source: telemetrySource,
        });

        if (telemetry && isReportableSendError(error)) {
          void telemetry.captureException(error, {
            source: telemetrySource,
            handled: true,
            adapter: failedAdapter,
          });
        }

        throw error;
      }
    },
    async sendBatch(messages, sendOptions) {
      const startedAt = Date.now();
      const results: SendBatchResult[] = [];
      const usedAdapters = new Set<string>();
      let failedCount = 0;
      let firstFailureCode: string | undefined;

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
          // Record the adapter that actually delivered (fallbacks change it), so the
          // summary matches the per-item "email sent" events.
          usedAdapters.add(normalizeAdapterName(response.provider));
          results.push({ ok: true, index, response });
        } catch (error) {
          usedAdapters.add(normalizeAdapterName(resolvedAdapter ?? defaultProvider));
          failedCount += 1;
          firstFailureCode ??= error instanceof EmailSdkError ? error.code : "unknown";
          results.push({ ok: false, index, error });
        }
      }

      // A batch may mix adapters across items; report the single one when uniform,
      // else "mixed" (per-item adapters stay accurate on the "email sent" events).
      const [firstAdapter, ...otherAdapters] = usedAdapters;
      const batchAdapter =
        usedAdapters.size === 0
          ? normalizeAdapterName(sendOptions?.adapter ?? sendOptions?.provider ?? defaultProvider)
          : otherAdapters.length === 0
            ? firstAdapter
            : "mixed";

      // Per-item telemetry (including failure exceptions) fires inside client.send;
      // this summary event only describes the batch shape.
      void telemetry?.capture("email batch sent", {
        message_count: messages.length,
        succeeded: results.length - failedCount,
        failed: failedCount,
        recipients: messages.reduce(
          (total, item) =>
            total + arrayify(item.to).length + arrayify(item.cc).length + arrayify(item.bcc).length,
          0,
        ),
        adapter: batchAdapter,
        success: failedCount === 0,
        duration_ms: Date.now() - startedAt,
        error_code: firstFailureCode,
        source: telemetrySource,
      });

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

/**
 * Telemetry label for how a send() call was (or would have been) delivered:
 * "single" for plain messages, "bulk_native" when the adapter batches
 * recipientVariables in one provider call, "bulk_expanded" when the client
 * expands to one internal send per recipient.
 */
function deliveryPath(
  usedRecipientVariables: boolean,
  provider: EmailProvider | undefined,
): "single" | "bulk_native" | "bulk_expanded" | undefined {
  if (!usedRecipientVariables) {
    return "single";
  }

  if (!provider) {
    return undefined;
  }

  return provider.sendBulk ? "bulk_native" : "bulk_expanded";
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
    const { provider } = input;
    const sendBulk = provider.sendBulk;

    if (!sendBulk) {
      return sendBulkViaFallback(input);
    }

    // 2026-07-06: sendBulk must stay invoked on the provider (not passed detached), so
    // class-based adapters that read `this` inside sendBulk keep working. `send` already
    // gets this via `input.provider.send(...)` in sendWithRetry.
    return sendWithRetry({
      ...input,
      perform: (message, context) => sendBulk.call(provider, message, context),
    });
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
