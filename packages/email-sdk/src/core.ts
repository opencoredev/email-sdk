import {
  acceptanceCounts,
  attemptAdapter,
  type AttemptPath,
  type MeasureAttempt,
} from "./core/attempts.js";
import {
  failureAttempt,
  normalizeAdapterFailure,
  normalizeOwnedError,
  throwIfAborted,
} from "./core/failures.js";
import {
  applyBeforeSendMiddleware,
  applyClientExtension,
  createPluginContext,
  invokeErrorMiddleware,
  invokeHooks,
  resolvePluginAdapters,
} from "./core/lifecycle.js";
import {
  attemptExpandedPersonalized,
  attemptNativePersonalized,
  expandPersonalizedMessage,
  personalizedMiddlewareMessage,
  validatePersonalizedInput,
  withPersonalizedMessage,
} from "./core/personalized.js";
import {
  addAdapter,
  canFallback,
  mergeSendOptions,
  requireAdapter,
  resolveRoute,
  type EmailRoute,
  validateCapabilities,
  validateFallback,
  validateRetry,
} from "./core/routing.js";
import { attemptStatus, classifyAttemptFailure } from "./core/failure-kind.js";
import {
  captureSendFailure,
  captureSendTelemetry,
  messageFacts,
  personalizedFacts,
} from "./core/send-telemetry.js";
import {
  EmailAbortError,
  EmailAdapterError,
  EmailAllRecipientsFailedError,
  EmailMiddlewareError,
  EmailRouteError,
  EmailValidationError,
} from "./errors.js";
import {
  getTelemetry,
  getTelemetrySource,
  normalizeAdapterName,
  type Telemetry,
} from "./telemetry.js";
import { isTestAdapter } from "./testing.js";
import type {
  EmailAdapter,
  EmailClient,
  EmailClientOptions,
  EmailHooks,
  EmailMessage,
  EmailPersonalizedInput,
  EmailPersonalizedResult,
  EmailPlugin,
  EmailPluginClientExtensions,
  EmailSendItem,
  EmailSendMiddleware,
  EmailSendOptions,
  EmailSendResult,
  EmailRetryConfig,
  EmailSendSettledResult,
  EmailValidationResult,
} from "./types.js";
import { isObjectLike } from "./internal/decode.js";
import { arrayify, assertMessage, isBuiltInAdapter } from "./utils.js";

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

  const defaultAdapter = options.defaultAdapter ?? adapters.keys().next().value;

  if (!defaultAdapter) {
    throw new EmailValidationError("createEmailClient requires at least one adapter.");
  }

  requireAdapter(adapters, defaultAdapter);
  validateRetry(options.retry);
  validateFallback(adapters, options.fallback);

  // A telemetry instance that starts disabled never turns on again, so the client drops it and
  // every send skips building telemetry facts.
  const sharedTelemetry = options.telemetry === false ? undefined : getTelemetry();
  const telemetry = sharedTelemetry?.enabled ? sharedTelemetry : undefined;
  const telemetrySource = getTelemetrySource();
  const hooks = [...pluginHooks, ...(options.hooks ? [options.hooks] : [])];

  const measureAttempt: MeasureAttempt = (adapter, path, recipients, invoke) => {
    if (!telemetry?.enabled) return invoke();

    return measureAttemptTelemetry(telemetry, adapter, path, recipients, invoke);
  };

  const measureAttemptTelemetry = async <T extends EmailSendResult>(
    telemetry: Telemetry,
    adapter: EmailAdapter,
    path: AttemptPath,
    recipients: number,
    invoke: () => T | PromiseLike<T>,
  ): Promise<T> => {
    const startedAt = Date.now();
    const adapterName = normalizeAdapterName(adapter.name);

    const adapterKind =
      isTestAdapter(adapter) || adapter.name === "memory"
        ? "test"
        : ["custom", "unknown"].includes(adapterName)
          ? "custom"
          : "provider";

    const provider = telemetry.realProviderVolume === true && adapterKind !== "test";
    let result: EmailSendResult | undefined;
    let failure: unknown;
    let resolved = false;

    try {
      const response = await invoke();
      result = response;
      resolved = true;

      return response;
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      // Optional recipient lists/counts are evidence; IDs and resolved promises are not.
      const adapterError = failure instanceof EmailAdapterError ? failure : undefined;

      const counts = acceptanceCounts(
        result?.accepted?.length ?? adapterError?.acceptedCount,
        result?.rejected?.length ?? adapterError?.rejectedCount,
        recipients,
        adapterError !== undefined,
      );

      const { accepted, rejected } = counts;
      const acceptedMessages = path === "personalized_native" ? accepted : Number(accepted > 0);
      const inferred = resolved && result?.accepted === undefined && result?.rejected === undefined;

      const acceptanceBasis = counts.explicit
        ? "explicit"
        : inferred
          ? "inferred_from_success"
          : "unknown";

      const submittedRecipients = inferred ? recipients : accepted;

      const submittedMessages =
        path === "personalized_native" ? submittedRecipients : Number(submittedRecipients > 0);

      const notSent = adapterError?.delivery === "not_sent" && accepted === 0;
      const unknownRecipients = notSent ? 0 : Math.max(0, recipients - accepted - rejected);
      void telemetry.capture("email adapter attempted", {
        failure_kind: resolved
          ? undefined
          : classifyAttemptFailure(adapter.name, failure),
        http_status: resolved ? undefined : attemptStatus(adapter.name, failure),
        measurement_schema_version: 2,
        measurement_scope: "adapter_attempt",
        adapter: adapterName,
        adapter_kind: adapterKind,
        delivery_path: path,
        source: telemetrySource,
        duration_ms: Date.now() - startedAt,
        adapter_attempt_count: 1,
        adapter_resolved_count: Number(resolved),
        adapter_failure_count: Number(!resolved),
        not_sent_attempt_count: Number(notSent),
        uncertain_attempt_count: Number(!resolved && !notSent),
        attempted_message_count: path === "personalized_native" ? recipients : 1,
        attempted_recipient_count: recipients,
        not_sent_recipient_count: notSent ? recipients : 0,
        accepted_message_count: acceptedMessages,
        accepted_recipient_count: accepted,
        rejected_recipient_count: rejected,
        unknown_recipient_count: unknownRecipients,
        provider_volume_eligible: provider,
        provider_attempt_count: Number(provider),
        provider_accepted_message_count: provider ? acceptedMessages : 0,
        provider_accepted_recipient_count: provider ? accepted : 0,
        acceptance_basis: acceptanceBasis,
        provider_submitted_message_count: provider ? submittedMessages : 0,
        provider_submitted_recipient_count: provider ? submittedRecipients : 0,
      });
    }
  };

  // Caller callbacks (adapter validate hooks, retry shouldRetry and delay) run
  // inside SDK code, so their throws get filed under a built-in adapter or
  // "unknown". They are remembered here to keep them out of error tracking.
  const callerErrors = new WeakSet<object>();

  const callerOwned = <Result>(run: () => Result): Result => {
    try {
      return run();
    } catch (error) {
      if (isObjectLike(error)) callerErrors.add(error);

      throw error;
    }
  };

  const callerRetry = (retry: EmailRetryConfig | undefined): EmailRetryConfig | undefined => {
    if (!retry) return retry;
    const { shouldRetry, delay } = retry;

    return {
      ...retry,
      shouldRetry: shouldRetry && ((error, attempt) => callerOwned(() => shouldRetry(error, attempt))),
      delay: delay && ((attempt, error) => callerOwned(() => delay(attempt, error))),
    };
  };

  const isSdkOwned = (failure: EmailAdapterError) => {
    if (isObjectLike(failure.cause) && callerErrors.has(failure.cause)) return false;

    // "unknown" is core's own label, unless a caller registered an adapter by that name.
    if (failure.adapter === "unknown" && !adapters.has("unknown")) return true;

    return isBuiltInAdapter(adapters.get(failure.adapter));
  };

  void telemetry?.capture("client created", {
    adapters: [...adapters.keys()].map(normalizeAdapterName),
    adapter_count: adapters.size,
    plugin_count: options.plugins?.length ?? 0,
    default_adapter: normalizeAdapterName(defaultAdapter),
    source: telemetrySource,
  });

  const validateRoute = async (
    message: EmailMessage,
    route: EmailRoute,
    operation: "send" | "personalized",
  ) => {
    assertMessage(message);

    for (const name of route.names) {
      const adapter = requireAdapter(adapters, name);
      validateCapabilities(adapter, message, operation);

      try {
        // Built-in validators are synchronous; awaiting only real promises saves a microtask.
        const pending = adapter.validate?.(message, { adapter: name, operation });

        if (pending !== undefined) await pending;
      } catch (error) {
        if (!isBuiltInAdapter(adapter) && isObjectLike(error)) callerErrors.add(error);

        throw error;
      }
    }
  };

  const resolveCheckedRoute = (sendOptions: EmailSendOptions | undefined) => {
    validateRetry(sendOptions?.retry);
    const route = resolveRoute(defaultAdapter, options.fallback, sendOptions);
    validateFallback(adapters, route.fallback);

    return route;
  };

  const validate = async (
    message: EmailMessage,
    sendOptions?: EmailSendOptions,
  ): Promise<EmailValidationResult> => {
    const route = resolveCheckedRoute(sendOptions);
    await validateRoute(message, route, "send");

    return { adapter: route.primary, warnings: [] };
  };

  const send = async (
    message: EmailMessage,
    sendOptions?: EmailSendOptions,
  ): Promise<EmailSendResult> => {
    const startedAt = Date.now();
    const facts = telemetry && messageFacts(message);

    try {
      throwIfAborted(sendOptions?.signal);

      const prepared = await applyBeforeSendMiddleware(middleware, {
        message,
        options: sendOptions,
      });

      const route = resolveCheckedRoute(prepared.options);
      await validateRoute(prepared.message, route, "send");
      const retry = callerRetry(prepared.options?.retry ?? options.retry);
      const failures: EmailAdapterError[] = [];

      for (const [index, name] of route.names.entries()) {
        const adapter = requireAdapter(adapters, name);

        try {
          const result = await attemptAdapter({
            adapter,
            message: prepared.message,
            options: prepared.options,
            retry,
            hooks,
            middleware,
            measureAttempt,
          });

          if (facts) {
            captureSendTelemetry({
              telemetry,
              source: telemetrySource,
              startedAt,
              facts,
              adapter: result.adapter,
              success: true,
              messageCount: 1,
            });
          }

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

      if (facts) {
        captureSendFailure({
          telemetry,
          source: telemetrySource,
          startedAt,
          facts,
          adapter: sendOptions?.adapter ?? defaultAdapter,
          messageCount: 1,
          error: normalized,
          isSdkOwned,
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

        if (telemetry) usedAdapters.add(normalizeAdapterName(result.adapter));
        results.push({ ok: true, index, result });
      } catch (error) {
        const normalized = normalizeOwnedError(error);

        if (telemetry) {
          const adapter = item.options?.adapter ?? sendOptions?.adapter ?? defaultAdapter;
          usedAdapters.add(normalizeAdapterName(adapter));
        }

        failed += 1;
        firstErrorCode ??= normalized.code;
        results.push({ ok: false, index, error: normalized });
      }
    }

    if (!telemetry) return results;

    const adapter =
      usedAdapters.size === 0
        ? normalizeAdapterName(sendOptions?.adapter ?? defaultAdapter)
        : usedAdapters.size === 1
          ? [...usedAdapters][0]
          : "mixed";

    void telemetry.capture("email batch sent", {
      message_count: items.length,
      measurement_schema_version: 2,
      measurement_scope: "batch_summary",
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
    const facts = telemetry && personalizedFacts(input);
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
      validateRetry(prepared.options?.retry);

      const expanded = input.recipients.map((recipient) => ({
        recipient,
        message: expandPersonalizedMessage(preparedInput, recipient.to, recipient.variables),
      }));

      for (const { message } of expanded) {
        await validateRoute(message, route, "personalized");
      }

      const routeFailures: EmailAdapterError[] = [];

      // The helpers pick per-send retry over the client's, so both are wrapped
      // and the choice between them is left alone.
      const attemptOptions = prepared.options && {
        ...prepared.options,
        retry: callerRetry(prepared.options.retry),
      };

      const clientRetry = callerRetry(options.retry);

      for (const [index, name] of route.names.entries()) {
        const adapter = requireAdapter(adapters, name);
        deliveryPath = adapter.sendPersonalized ? "personalized_native" : "personalized_expanded";

        const result = adapter.sendPersonalized
          ? await attemptNativePersonalized(
              adapter,
              preparedInput,
              expanded[0]!.message,
              attemptOptions,
              clientRetry,
              hooks,
              middleware,
              measureAttempt,
            )
          : await attemptExpandedPersonalized(
              adapter,
              expanded,
              attemptOptions,
              clientRetry,
              hooks,
              middleware,
              measureAttempt,
            );

        if (result.accepted.length > 0) {
          if (facts) {
            captureSendTelemetry({
              telemetry,
              source: telemetrySource,
              startedAt,
              facts,
              adapter: result.adapter,
              success: true,
              messageCount: facts.recipients,
              deliveryPath,
            });
          }

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

      if (facts) {
        captureSendFailure({
          telemetry,
          source: telemetrySource,
          startedAt,
          facts,
          adapter: attemptedAdapter,
          messageCount: facts.recipients,
          error: normalized,
          isSdkOwned,
          deliveryPath,
        });
      }

      throw normalized;
    }
  };

  // SAFETY: Every adapter in options.adapters was registered under its own name, so route names
  // and adapter lookups match TAdapters. The loop below attaches each plugin's client extension
  // before the client is returned.
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
    flush() {
      return sharedTelemetry?.flush() ?? Promise.resolve();
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
  } as EmailClient<TAdapters, EmailPluginClientExtensions<TPlugins>>;

  for (const plugin of extensionPlugins) {
    const extension = plugin.extendClient?.(createPluginContext(adapters, defaultAdapter));

    if (extension) applyClientExtension(client, plugin.id, extension);
  }

  return client;
}
