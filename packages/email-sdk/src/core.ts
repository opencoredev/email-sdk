import {
  EmailAbortError,
  EmailAdapterError,
  EmailAdapterNotFoundError,
  EmailAllRecipientsFailedError,
  EmailMiddlewareError,
  EmailRouteError,
  EmailSdkError,
  EmailValidationError,
  isRetryableEmailError,
} from "./errors.js";
import type {
  EmailAdapter,
  EmailAfterSendEvent,
  EmailBeforeSendEvent,
  EmailClient,
  EmailClientOptions,
  EmailErrorEvent,
  EmailFallbackConfig,
  EmailHookEvent,
  EmailHooks,
  EmailMessage,
  EmailPersonalizedInput,
  EmailPersonalizedResult,
  EmailPlugin,
  EmailPluginClientExtensions,
  EmailPluginContext,
  EmailRetryConfig,
  EmailSendItem,
  EmailSendMiddleware,
  EmailSendOptions,
  EmailSendResult,
  EmailSendSettledResult,
  EmailValidationResult,
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
  emailAddressOf,
  normalizeAdapterResult,
  toProviderError,
} from "./utils.js";

const defaultDelay = (attempt: number) => Math.min(100 * 2 ** (attempt - 1), 2_000);

export function createEmailClient<
  const TAdapters extends readonly EmailAdapter[],
  const TPlugins extends readonly EmailPlugin[] = readonly EmailPlugin[],
>(
  options: EmailClientOptions<TAdapters, TPlugins>,
): EmailClient<TAdapters, EmailPluginClientExtensions<TPlugins>> {
  const adapters = new Map<string, EmailAdapter>();
  const pluginHooks: EmailHooks[] = [];
  const middleware: EmailSendMiddleware[] = [];
  const extensionPlugins: EmailPlugin[] = [];

  for (const adapter of options.adapters ?? []) addAdapter(adapters, adapter);

  const requestedDefault = options.defaultAdapter ?? options.adapters?.[0]?.name ?? "";
  const pluginIds = new Set<string>();

  for (const plugin of options.plugins ?? []) {
    if (pluginIds.has(plugin.id)) {
      throw new EmailValidationError(`Duplicate email plugin "${plugin.id}".`);
    }
    pluginIds.add(plugin.id);

    const context = createPluginContext(adapters, requestedDefault);
    for (const adapter of resolvePluginAdapters(plugin, context)) {
      if (adapters.get(adapter.name) !== adapter) context.addAdapter(adapter);
    }
    if (plugin.hooks) pluginHooks.push(plugin.hooks);
    middleware.push(...(plugin.middleware ?? []));
    if (plugin.extendClient) extensionPlugins.push(plugin);
  }

  const defaultAdapter = (options.defaultAdapter ?? adapters.keys().next().value) as
    | string
    | undefined;
  if (!defaultAdapter) {
    throw new EmailValidationError("createEmailClient requires at least one adapter.");
  }
  requireAdapter(adapters, defaultAdapter);
  validateRetry(options.retry);
  validateFallback(adapters, options.fallback);

  const telemetry = options.telemetry === false ? undefined : getTelemetry();
  const telemetrySource = getTelemetrySource();
  const hooks = [...pluginHooks, ...(options.hooks ? [options.hooks] : [])];

  void telemetry?.capture("client created", {
    adapters: [...adapters.keys()].map(normalizeAdapterName),
    adapter_count: adapters.size,
    plugin_count: options.plugins?.length ?? 0,
    default_adapter: normalizeAdapterName(defaultAdapter),
    source: telemetrySource,
  });

  const validate = async (
    message: EmailMessage,
    sendOptions?: EmailSendOptions,
    operation: "send" | "personalized" = "send",
  ): Promise<EmailValidationResult> => {
    validateRetry(sendOptions?.retry);
    const route = resolveRoute(defaultAdapter, options.fallback, sendOptions);
    validateFallback(adapters, route.fallback);
    assertMessage(message);

    for (const name of route.names) {
      const adapter = requireAdapter(adapters, name);
      validateCapabilities(adapter, message, operation);
      await adapter.validate?.(message, { adapter: name, operation });
    }

    return { adapter: route.primary, warnings: [] };
  };

  const send = async (
    message: EmailMessage,
    sendOptions?: EmailSendOptions,
  ): Promise<EmailSendResult> => {
    const startedAt = Date.now();
    const facts = messageFacts(message);

    try {
      throwIfAborted(sendOptions?.signal);
      const prepared = await applyBeforeSendMiddleware(middleware, {
        message,
        options: sendOptions,
      });
      const route = resolveRoute(defaultAdapter, options.fallback, prepared.options);
      await validate(prepared.message, prepared.options);
      const failures: EmailAdapterError[] = [];

      for (const [index, name] of route.names.entries()) {
        const adapter = requireAdapter(adapters, name);
        try {
          const result = await attemptAdapter({
            adapter,
            message: prepared.message,
            options: prepared.options,
            retry: prepared.options?.retry ?? options.retry,
            hooks,
            middleware,
          });
          captureSendTelemetry(telemetry, telemetrySource, startedAt, facts, result.adapter, true);
          return result;
        } catch (error) {
          if (
            error instanceof EmailAbortError ||
            error instanceof EmailValidationError ||
            error instanceof EmailMiddlewareError
          ) {
            throw error;
          }

          const failure = normalizeAdapterFailure(name, error);
          failures.push(failure);
          await invokeErrorMiddleware(middleware, {
            adapter: name,
            message: prepared.message,
            attempt: failureAttempt(error),
            metadata: prepared.options?.metadata,
            error: failure,
          });
          await invokeHooks(hooks, "onError", {
            adapter: name,
            message: prepared.message,
            attempt: failureAttempt(error),
            metadata: prepared.options?.metadata,
            error: failure,
          });

          const hasNext = index < route.names.length - 1;
          if (!hasNext || !canFallback(failure, route.fallback)) break;
        }
      }

      throw new EmailRouteError(failures);
    } catch (error) {
      const normalized = normalizeOwnedError(error);
      const attemptedAdapter = sendOptions?.adapter ?? defaultAdapter;
      captureSendTelemetry(
        telemetry,
        telemetrySource,
        startedAt,
        facts,
        attemptedAdapter,
        false,
        normalized.code,
      );
      if (telemetry && isReportableSendError(normalized)) {
        void telemetry.captureException(normalized, {
          source: telemetrySource,
          handled: true,
          adapter: normalizeAdapterName(attemptedAdapter),
        });
      }
      throw normalized;
    }
  };

  const sendMany = async (
    items: readonly EmailSendItem[],
    sendOptions?: EmailSendOptions,
  ): Promise<readonly EmailSendSettledResult[]> => {
    const startedAt = Date.now();
    const results: EmailSendSettledResult[] = [];
    const usedAdapters = new Set<string>();
    let failed = 0;
    let firstErrorCode: string | undefined;

    for (const [index, item] of items.entries()) {
      try {
        const result = await send(item.message, mergeSendOptions(sendOptions, item.options));
        usedAdapters.add(normalizeAdapterName(result.adapter));
        results.push({ ok: true, index, result });
      } catch (error) {
        const normalized = normalizeOwnedError(error);
        const adapter = item.options?.adapter ?? sendOptions?.adapter ?? defaultAdapter;
        usedAdapters.add(normalizeAdapterName(adapter));
        failed += 1;
        firstErrorCode ??= normalized.code;
        results.push({ ok: false, index, error: normalized });
      }
    }

    const adapter =
      usedAdapters.size === 0
        ? normalizeAdapterName(sendOptions?.adapter ?? defaultAdapter)
        : usedAdapters.size === 1
          ? [...usedAdapters][0]
          : "mixed";

    void telemetry?.capture("email batch sent", {
      message_count: items.length,
      succeeded: items.length - failed,
      failed,
      recipients: items.reduce(
        (total, item) =>
          total +
          arrayify(item.message.to).length +
          arrayify(item.message.cc).length +
          arrayify(item.message.bcc).length,
        0,
      ),
      adapter,
      success: failed === 0,
      duration_ms: Date.now() - startedAt,
      error_code: firstErrorCode,
      source: telemetrySource,
    });

    return results;
  };

  const sendPersonalized = async (
    input: EmailPersonalizedInput,
    sendOptions?: EmailSendOptions,
  ): Promise<EmailPersonalizedResult> => {
    const startedAt = Date.now();
    const facts = personalizedFacts(input);
    let attemptedAdapter = sendOptions?.adapter ?? defaultAdapter;
    let deliveryPath = "personalized";

    try {
      validatePersonalizedInput(input);
      throwIfAborted(sendOptions?.signal);
      const prepared = await applyBeforeSendMiddleware(middleware, {
        message: personalizedMiddlewareMessage(input),
        options: sendOptions,
      });
      const preparedInput = withPersonalizedMessage(input, prepared.message);
      const route = resolveRoute(defaultAdapter, options.fallback, prepared.options);
      attemptedAdapter = route.primary;
      validateFallback(adapters, route.fallback);
      const expanded = input.recipients.map((recipient) => ({
        recipient,
        message: expandPersonalizedMessage(preparedInput, recipient.to, recipient.variables),
      }));

      for (const { message } of expanded) {
        await validate(message, prepared.options, "personalized");
      }

      const routeFailures: EmailAdapterError[] = [];

      for (const [index, name] of route.names.entries()) {
        const adapter = requireAdapter(adapters, name);
        deliveryPath = adapter.sendPersonalized ? "personalized_native" : "personalized_expanded";
        const result = adapter.sendPersonalized
          ? await attemptNativePersonalized(
              adapter,
              preparedInput,
              expanded[0]!.message,
              prepared.options,
              options.retry,
              hooks,
              middleware,
            )
          : await attemptExpandedPersonalized(
              adapter,
              expanded,
              prepared.options,
              options.retry,
              hooks,
              middleware,
            );

        if (result.accepted.length > 0) {
          captureSendTelemetry(
            telemetry,
            telemetrySource,
            startedAt,
            facts,
            result.adapter,
            true,
            undefined,
            deliveryPath,
            result.accepted.length,
            result.rejected.length,
            result.failures.length,
          );
          return result;
        }

        routeFailures.push(...result.failures);
        const hasNext = index < route.names.length - 1;
        const mayFallback =
          hasNext &&
          result.failures.length > 0 &&
          result.failures.every((failure) => canFallback(failure, route.fallback));
        if (!mayFallback) break;
      }

      throw new EmailAllRecipientsFailedError(routeFailures);
    } catch (error) {
      const normalized = normalizeOwnedError(error);
      captureSendTelemetry(
        telemetry,
        telemetrySource,
        startedAt,
        facts,
        attemptedAdapter,
        false,
        normalized.code,
        deliveryPath,
        0,
        facts.recipients,
        normalized instanceof EmailAllRecipientsFailedError ? normalized.failures.length : undefined,
      );
      if (telemetry && isReportableSendError(normalized)) {
        void telemetry.captureException(normalized, {
          source: telemetrySource,
          handled: true,
          adapter: normalizeAdapterName(attemptedAdapter),
        });
      }
      throw normalized;
    }
  };

  const client = {
    adapters,
    defaultAdapter,
    validate(message: EmailMessage, sendOptions?: EmailSendOptions) {
      return validate(message, sendOptions);
    },
    send,
    sendMany,
    sendPersonalized,
    adapter(name: string) {
      return requireAdapter(adapters, name);
    },
    withAdapter(name: string) {
      requireAdapter(adapters, name);
      const routeOptions = <T extends EmailSendOptions | undefined>(value: T) => ({
        ...value,
        adapter: name,
      });
      return {
        validate(message: EmailMessage, sendOptions?: EmailSendOptions) {
          return validate(message, routeOptions(sendOptions));
        },
        send(message: EmailMessage, sendOptions?: EmailSendOptions) {
          return send(message, routeOptions(sendOptions));
        },
        sendMany(items: readonly EmailSendItem[], sendOptions?: EmailSendOptions) {
          return sendMany(items, routeOptions(sendOptions));
        },
        sendPersonalized(input: EmailPersonalizedInput, sendOptions?: EmailSendOptions) {
          return sendPersonalized(input, routeOptions(sendOptions));
        },
      };
    },
  } as unknown as EmailClient<TAdapters, EmailPluginClientExtensions<TPlugins>>;

  for (const plugin of extensionPlugins) {
    const extension = plugin.extendClient?.(createPluginContext(adapters, defaultAdapter));
    if (extension) applyClientExtension(client, plugin.id, extension);
  }

  return client;
}

type AttemptInput = {
  adapter: EmailAdapter;
  message: EmailMessage;
  options?: EmailSendOptions;
  retry?: EmailRetryConfig;
  hooks: EmailHooks[];
  middleware: EmailSendMiddleware[];
};

class AttemptFailure {
  constructor(
    readonly error: EmailSdkError,
    readonly attempt: number,
  ) {}
}

async function attemptAdapter(input: AttemptInput): Promise<EmailSendResult> {
  const maxAttempts = input.retry?.maxAttempts ?? 1;
  const shouldRetry = input.retry?.shouldRetry ?? isRetryableEmailError;
  const delayFor = input.retry?.delay ?? defaultDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(input.options?.signal);
    const event = hookEvent(input.adapter.name, input.message, attempt, input.options?.metadata);
    await invokeHooks(input.hooks, "beforeSend", event);

    let result: EmailSendResult;
    try {
      const adapterResult = await input.adapter.send(input.message, {
        adapter: input.adapter.name,
        operation: "send",
        attempt,
        signal: input.options?.signal,
        idempotencyKey: input.options?.idempotencyKey,
        metadata: input.options?.metadata,
      });
      throwIfAborted(input.options?.signal);
      result = normalizeAdapterResult(input.adapter.name, adapterResult);
    } catch (error) {
      if (isAbort(error, input.options?.signal)) throw new EmailAbortError(error);
      if (error instanceof EmailValidationError || error instanceof EmailMiddlewareError)
        throw error;
      const normalized = toProviderError(input.adapter.name, error);
      if (!(normalized instanceof EmailAdapterError)) throw normalized;
      const canRetry = attempt < maxAttempts && shouldRetry(normalized, attempt);
      if (!canRetry) throw new AttemptFailure(normalized, attempt);

      const delayMs = Math.max(0, delayFor(attempt, normalized));
      await invokeHooks(input.hooks, "onRetry", {
        ...event,
        error: normalized,
        nextAttempt: attempt + 1,
        delayMs,
      });
      await sleep(delayMs, input.options?.signal);
      continue;
    }

    const afterEvent: EmailAfterSendEvent = { ...event, response: result };
    await invokeAfterSendMiddleware(input.middleware, afterEvent);
    await invokeHooks(input.hooks, "afterSend", afterEvent);
    return result;
  }

  throw new EmailAdapterError("Email retry loop exited unexpectedly.", {
    adapter: input.adapter.name,
    delivery: "unknown",
  });
}

async function attemptNativePersonalized(
  adapter: EmailAdapter,
  input: EmailPersonalizedInput,
  hookMessage: EmailMessage,
  sendOptions: EmailSendOptions | undefined,
  clientRetry: EmailRetryConfig | undefined,
  hooks: EmailHooks[],
  middleware: EmailSendMiddleware[],
): Promise<PersonalizedAttempt> {
  const maxAttempts = sendOptions?.retry?.maxAttempts ?? clientRetry?.maxAttempts ?? 1;
  const retry = sendOptions?.retry ?? clientRetry;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(sendOptions?.signal);
    const event = hookEvent(adapter.name, hookMessage, attempt, sendOptions?.metadata);
    await invokeHooks(hooks, "beforeSend", event);
    try {
      const result = await adapter.sendPersonalized!(input, {
        adapter: adapter.name,
        operation: "personalized",
        attempt,
        signal: sendOptions?.signal,
        idempotencyKey: sendOptions?.idempotencyKey,
        metadata: sendOptions?.metadata,
      });
      throwIfAborted(sendOptions?.signal);
      const normalized = normalizeAdapterResult(adapter.name, result);
      const personalized = {
        ...normalized,
        accepted: result.accepted,
        rejected: result.rejected,
      };
      if (personalized.accepted.length > 0) {
        await invokeAfterSendMiddleware(middleware, { ...event, response: personalized });
        await invokeHooks(hooks, "afterSend", { ...event, response: personalized });
        return { ...personalized, failures: [] };
      }
      const failure = new EmailAdapterError(
        `${adapter.name} rejected every personalized recipient.`,
        {
          adapter: adapter.name,
          delivery: "not_sent",
        },
      );
      await invokeSendFailureLifecycle(middleware, hooks, {
        ...event,
        error: failure,
      });
      return {
        ...personalized,
        failures: [failure],
      };
    } catch (error) {
      if (isAbort(error, sendOptions?.signal)) throw new EmailAbortError(error);
      if (error instanceof EmailMiddlewareError || error instanceof EmailValidationError)
        throw error;
      const failure = normalizeAdapterFailure(adapter.name, error);
      const canRetry =
        attempt < maxAttempts && (retry?.shouldRetry ?? isRetryableEmailError)(failure, attempt);
      if (!canRetry) {
        await invokeSendFailureLifecycle(middleware, hooks, {
          ...event,
          error: failure,
        });
        return { adapter: adapter.name, accepted: [], rejected: [], failures: [failure] };
      }
      const delayMs = Math.max(0, (retry?.delay ?? defaultDelay)(attempt, failure));
      await invokeHooks(hooks, "onRetry", {
        ...event,
        error: failure,
        nextAttempt: attempt + 1,
        delayMs,
      });
      await sleep(delayMs, sendOptions?.signal);
    }
  }

  return { adapter: adapter.name, accepted: [], rejected: [], failures: [] };
}

type ExpandedRecipient = {
  recipient: EmailPersonalizedInput["recipients"][number];
  message: EmailMessage;
};

type PersonalizedAttempt = EmailPersonalizedResult & {
  failures: EmailAdapterError[];
};

async function attemptExpandedPersonalized(
  adapter: EmailAdapter,
  expanded: readonly ExpandedRecipient[],
  sendOptions: EmailSendOptions | undefined,
  clientRetry: EmailRetryConfig | undefined,
  hooks: EmailHooks[],
  middleware: EmailSendMiddleware[],
): Promise<PersonalizedAttempt> {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const failures: EmailAdapterError[] = [];
  let firstResult: EmailSendResult | undefined;

  for (const { recipient, message } of expanded) {
    const address = emailAddressOf(recipient.to);
    try {
      const result = await attemptAdapter({
        adapter,
        message,
        options: {
          ...sendOptions,
          fallback: undefined,
          idempotencyKey: recipientIdempotencyKey(sendOptions?.idempotencyKey, address),
        },
        retry: sendOptions?.retry ?? clientRetry,
        hooks,
        middleware,
      });
      firstResult ??= result;
      accepted.push(address);
    } catch (error) {
      if (
        error instanceof EmailAbortError ||
        error instanceof EmailMiddlewareError ||
        error instanceof EmailValidationError
      ) {
        throw error;
      }
      rejected.push(address);
      const failure = normalizeAdapterFailure(adapter.name, error);
      failures.push(failure);
      await invokeSendFailureLifecycle(middleware, hooks, {
        adapter: adapter.name,
        message,
        attempt: failureAttempt(error),
        metadata: sendOptions?.metadata,
        error: failure,
      });
    }
  }

  return {
    adapter: adapter.name,
    id: firstResult?.id,
    raw: firstResult?.raw,
    accepted,
    rejected,
    failures,
  };
}

function validateCapabilities(
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

function validatePersonalizedInput(input: EmailPersonalizedInput) {
  if (input.recipients.length === 0) {
    throw new EmailValidationError("sendPersonalized requires at least one recipient.");
  }

  const recipients = new Set<string>();
  for (const recipient of input.recipients) {
    const address = emailAddressOf(recipient.to).toLowerCase();
    if (!address)
      throw new EmailValidationError("Personalized recipients require an email address.");
    if (recipients.has(address)) {
      throw new EmailValidationError(`Personalized recipient "${address}" appears more than once.`);
    }
    recipients.add(address);

    for (const key of Object.keys(recipient.variables)) {
      if (!/^[\w-]+$/.test(key)) {
        throw new EmailValidationError(
          `Personalized variable keys may only contain letters, numbers, underscores, and hyphens: "${key}".`,
        );
      }
    }
  }
}

function personalizedMiddlewareMessage(input: EmailPersonalizedInput): EmailMessage {
  const first = input.recipients[0];
  if (!first) {
    return { ...input.message, to: "" } as EmailMessage;
  }

  return {
    ...input.message,
    to: first.to,
  } as EmailMessage;
}

function withPersonalizedMessage(
  input: EmailPersonalizedInput,
  message: EmailMessage,
): EmailPersonalizedInput {
  const { to: _to, cc: _cc, bcc: _bcc, ...template } = message;

  return {
    message: template as EmailPersonalizedInput["message"],
    recipients: input.recipients,
  };
}

function expandPersonalizedMessage(
  input: EmailPersonalizedInput,
  to: EmailPersonalizedInput["recipients"][number]["to"],
  variables: EmailPersonalizedInput["recipients"][number]["variables"],
): EmailMessage {
  const render = (value: string | undefined) =>
    value?.replace(/%recipient\.([\w-]+)%/g, (_match, key: string) =>
      Object.hasOwn(variables, key) ? String(variables[key]) : `%recipient.${key}%`,
    );

  return {
    ...input.message,
    to,
    subject: render(input.message.subject) ?? input.message.subject,
    html: render(input.message.html),
    text: render(input.message.text),
  } as EmailMessage;
}

function recipientIdempotencyKey(base: string | undefined, address: string) {
  return base ? `${base}:${address}` : undefined;
}

function resolveRoute(
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

function canFallback(error: EmailAdapterError, fallback: EmailFallbackConfig | undefined) {
  return error.delivery === "not_sent" || fallback?.onUnknownDelivery === "continue";
}

function validateRetry(retry: EmailRetryConfig | undefined) {
  if (
    retry?.maxAttempts !== undefined &&
    (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1)
  ) {
    throw new EmailValidationError(
      "retry.maxAttempts must be an integer greater than or equal to 1.",
    );
  }
}

function validateFallback(
  adapters: ReadonlyMap<string, EmailAdapter>,
  fallback: EmailFallbackConfig | undefined,
) {
  for (const name of fallback?.adapters ?? []) requireAdapter(adapters, name);
}

function mergeSendOptions(
  base: EmailSendOptions | undefined,
  override: EmailSendOptions | undefined,
): EmailSendOptions | undefined {
  if (!base) return override;
  if (!override) return base;
  return { ...base, ...override };
}

function requireAdapter(adapters: ReadonlyMap<string, EmailAdapter>, name: string) {
  const adapter = adapters.get(name);
  if (!adapter) throw new EmailAdapterNotFoundError(name);
  return adapter;
}

function addAdapter(adapters: Map<string, EmailAdapter>, adapter: EmailAdapter) {
  if (adapters.has(adapter.name)) {
    throw new EmailValidationError(`Duplicate email adapter "${adapter.name}".`);
  }
  adapters.set(adapter.name, adapter);
}

function createPluginContext(
  adapters: Map<string, EmailAdapter>,
  defaultAdapter: string,
): EmailPluginContext {
  return {
    adapters,
    defaultAdapter,
    addAdapter(adapter) {
      addAdapter(adapters, adapter);
    },
  };
}

function resolvePluginAdapters(plugin: EmailPlugin, context: EmailPluginContext): EmailAdapter[] {
  if (!plugin.adapters) return [];
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

function applyClientExtension(client: object, pluginId: string, extension: object) {
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
) {
  let message = event.message;
  let options = event.options;

  for (const item of middleware) {
    try {
      const result = await item.beforeSend?.({ message, options });
      if (result?.message) message = result.message;
      if (result?.options) options = { ...options, ...result.options };
    } catch (error) {
      throw new EmailMiddlewareError("before_send", error);
    }
  }

  return { message, options };
}

async function invokeAfterSendMiddleware(
  middleware: EmailSendMiddleware[],
  event: EmailAfterSendEvent,
) {
  for (const item of middleware) {
    try {
      await item.afterSend?.(event);
    } catch (error) {
      throw new EmailMiddlewareError("after_send", error);
    }
  }
}

async function invokeErrorMiddleware(middleware: EmailSendMiddleware[], event: EmailErrorEvent) {
  for (const item of middleware) {
    try {
      await item.onError?.(event);
    } catch (error) {
      throw new EmailMiddlewareError("on_error", error);
    }
  }
}

async function invokeSendFailureLifecycle(
  middleware: EmailSendMiddleware[],
  hooks: EmailHooks[],
  event: EmailErrorEvent,
) {
  await invokeErrorMiddleware(middleware, event);
  await invokeHooks(hooks, "onError", event);
}

async function invokeHooks<K extends keyof EmailHooks>(
  hooks: EmailHooks[],
  name: K,
  event: Parameters<NonNullable<EmailHooks[K]>>[0],
) {
  for (const hook of hooks) {
    try {
      const handler = hook[name] as
        | ((value: typeof event) => unknown | Promise<unknown>)
        | undefined;
      await handler?.(event);
    } catch {
      // Hooks are observability callbacks and never change delivery behavior.
    }
  }
}

function hookEvent(
  adapter: string,
  message: EmailMessage,
  attempt: number,
  metadata: Readonly<Record<string, unknown>> | undefined,
): EmailHookEvent {
  return { adapter, message, attempt, metadata };
}

function normalizeAdapterFailure(adapter: string, error: unknown): EmailAdapterError {
  if (error instanceof AttemptFailure) return normalizeAdapterFailure(adapter, error.error);
  if (error instanceof EmailAdapterError) return error;
  const normalized = toProviderError(adapter, error);
  return normalized instanceof EmailAdapterError
    ? normalized
    : new EmailAdapterError(normalized.message, {
        adapter,
        retryable: normalized.retryable,
        delivery: "unknown",
        cause: normalized,
      });
}

function failureAttempt(error: unknown) {
  return error instanceof AttemptFailure ? error.attempt : 1;
}

function normalizeOwnedError(error: unknown): EmailSdkError {
  if (error instanceof EmailSdkError) return error;
  return new EmailAdapterError(error instanceof Error ? error.message : "Email sending failed.", {
    adapter: "unknown",
    delivery: "unknown",
    cause: error,
  });
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new EmailAbortError(signal.reason);
}

function isAbort(error: unknown, signal: AbortSignal | undefined) {
  return signal?.aborted || (error instanceof Error && error.name === "AbortError");
}

function sleep(delayMs: number, signal: AbortSignal | undefined) {
  if (delayMs <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(new EmailAbortError(signal?.reason));
    };
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function messageFacts(message: EmailMessage) {
  return {
    recipients:
      arrayify(message.to).length + arrayify(message.cc).length + arrayify(message.bcc).length,
    has_attachments: (message.attachments?.length ?? 0) > 0,
    used_recipient_variables: false,
    used_send_at: message.sendAt !== undefined,
  };
}

function personalizedFacts(input: EmailPersonalizedInput) {
  return {
    recipients: input.recipients.length,
    personalized_recipient_count: input.recipients.length,
    has_attachments: (input.message.attachments?.length ?? 0) > 0,
    used_recipient_variables: input.recipients.some(
      (recipient) => Object.keys(recipient.variables).length > 0,
    ),
    used_send_at: input.message.sendAt !== undefined,
  };
}

function captureSendTelemetry(
  telemetry: ReturnType<typeof getTelemetry> | undefined,
  source: string,
  startedAt: number,
  facts: ReturnType<typeof messageFacts> | ReturnType<typeof personalizedFacts>,
  adapter: string,
  success: boolean,
  errorCode?: string,
  deliveryPath = "single",
  acceptedRecipientCount?: number,
  rejectedRecipientCount?: number,
  failureCount?: number,
) {
  void telemetry?.capture("email sent", {
    ...facts,
    adapter: normalizeAdapterName(adapter),
    delivery_path: deliveryPath,
    success,
    duration_ms: Date.now() - startedAt,
    error_code: errorCode,
    accepted_recipient_count: acceptedRecipientCount,
    rejected_recipient_count: rejectedRecipientCount,
    failure_count: failureCount,
    source,
  });
}
