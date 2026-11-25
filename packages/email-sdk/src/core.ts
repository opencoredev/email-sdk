import {
  acceptanceCounts,
  nativeAttemptFacts,
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
  cloneAdapterError,
  createPluginContext,
  invokeErrorMiddleware,
  invokeHooks,
  resolvePluginAdapters,
} from "./core/lifecycle.js";
import {
  assertNativeKeepsRecipients,
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
  cloneNestedSendOptions,
  mergeSendOptions,
  requireAdapter,
  resolveRoute,
  snapshotFallbackConfig,
  snapshotRetryConfig,
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
  recipientCount,
} from "./core/send-telemetry.js";
import {
  EmailAbortError,
  EmailAdapterError,
  EmailAdapterNotFoundError,
  EmailAllRecipientsFailedError,
  EmailMiddlewareError,
  EmailRouteError,
  EmailSdkError,
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
  MaybePromise,
  EmailPersonalizedInput,
  EmailPersonalizedResult,
  EmailPlugin,
  EmailPluginClientExtensions,
  EmailSendItem,
  EmailNativeSendManyOptions,
  EmailSendMiddleware,
  EmailNativeObject,
  EmailNativeOptionsMap,
  EmailNativeSendOptions,
  EmailSendResult,
  EmailRetryConfig,
  EmailSendSettledResult,
  EmailValidationResult,
} from "./types.js";
import {
  cloneMetadataRecord,
  isFunction,
  isNonArrayObject,
  isObjectLike,
  isStringMember,
} from "./internal/decode.js";
import { ReadonlyMapView } from "./internal/readonly-map.js";
import {
  copyBoundedArray,
  snapshotMessage,
  snapshotPersonalizedInputForSend,
} from "./internal/snapshot.js";
import { assertMessage, isBuiltInAdapter } from "./utils.js";

function snapshotHooks(raw: EmailHooks, label: string): EmailHooks {
  if (!isNonArrayObject(raw)) {
    throw new EmailValidationError(`${label} must be an object.`);
  }

  const copy: EmailHooks = {};

  if ("beforeSend" in raw) {
    const fn = raw.beforeSend;

    if (fn !== undefined) {
      if (!isFunction(fn)) {
        throw new EmailValidationError(`${label}.beforeSend must be a function.`);
      }

      copy.beforeSend = (event) => Function.prototype.call.call(fn, raw, event);
    }
  }

  if ("afterSend" in raw) {
    const fn = raw.afterSend;

    if (fn !== undefined) {
      if (!isFunction(fn)) {
        throw new EmailValidationError(`${label}.afterSend must be a function.`);
      }

      copy.afterSend = (event) => Function.prototype.call.call(fn, raw, event);
    }
  }

  if ("onError" in raw) {
    const fn = raw.onError;

    if (fn !== undefined) {
      if (!isFunction(fn)) {
        throw new EmailValidationError(`${label}.onError must be a function.`);
      }

      copy.onError = (event) => Function.prototype.call.call(fn, raw, event);
    }
  }

  if ("onRetry" in raw) {
    const fn = raw.onRetry;

    if (fn !== undefined) {
      if (!isFunction(fn)) {
        throw new EmailValidationError(`${label}.onRetry must be a function.`);
      }

      copy.onRetry = (event) => Function.prototype.call.call(fn, raw, event);
    }
  }

  return copy;
}

type NativeSendItem = EmailSendItem<string, EmailNativeOptionsMap>;

export function createEmailClient<
  const TAdapters extends readonly EmailAdapter[],
  const TPlugins extends readonly EmailPlugin[] = readonly EmailPlugin[],
>(
  options: EmailClientOptions<TAdapters, TPlugins>,
): EmailClient<TAdapters, EmailPluginClientExtensions<TPlugins>> {
  let rawAdapters: readonly EmailAdapter[] | undefined;
  let rawPlugins: readonly EmailPlugin[] | undefined;
  let rawDefaultAdapter: string | undefined;
  let rawFallback: EmailClientOptions<TAdapters, TPlugins>["fallback"];
  let rawRetry: EmailRetryConfig | undefined;
  let rawHooks: EmailHooks | undefined;
  let rawTelemetry: EmailClientOptions<TAdapters, TPlugins>["telemetry"];

  try {
    if (!isNonArrayObject(options)) {
      throw new EmailValidationError("createEmailClient options must be an object.");
    }

    rawAdapters = options.adapters;
    rawPlugins = options.plugins;
    rawDefaultAdapter = options.defaultAdapter;
    rawFallback = options.fallback;
    rawRetry = options.retry;
    rawHooks = options.hooks;
    rawTelemetry = options.telemetry;

    if (rawAdapters !== undefined && !Array.isArray(rawAdapters)) {
      throw new EmailValidationError("createEmailClient adapters must be an array.");
    }

    if (rawPlugins !== undefined && !Array.isArray(rawPlugins)) {
      throw new EmailValidationError("createEmailClient plugins must be an array.");
    }

    if (rawHooks !== undefined && !isNonArrayObject(rawHooks)) {
      throw new EmailValidationError("createEmailClient hooks must be an object.");
    }

    if (rawTelemetry !== undefined && rawTelemetry !== true && rawTelemetry !== false) {
      throw new EmailValidationError("createEmailClient telemetry must be a boolean.");
    }
  } catch (error) {
    if (error instanceof EmailSdkError) throw error;

    throw new EmailValidationError("createEmailClient options could not be read.", error);
  }

  const adapters = new Map<string, EmailAdapter>();
  const pluginHooks: EmailHooks[] = [];
  const middleware: EmailSendMiddleware[] = [];
  const extensionPlugins: Array<Pick<EmailPlugin, "id" | "extendClient">> = [];

  try {
    const adapterList = rawAdapters
      ? copyBoundedArray(rawAdapters, "createEmailClient adapters")
      : [];

    for (const adapter of adapterList) addAdapter(adapters, adapter);
  } catch (error) {
    if (error instanceof EmailSdkError) throw error;

    throw new EmailValidationError("createEmailClient adapters could not be read.", error);
  }

  const requestedDefault = rawDefaultAdapter ?? adapters.keys().next().value ?? "";
  const pluginIds = new Set<string>();
  let pluginList: readonly EmailPlugin[];

  try {
    pluginList = rawPlugins ? copyBoundedArray(rawPlugins, "createEmailClient plugins") : [];
  } catch (error) {
    if (error instanceof EmailSdkError) throw error;

    throw new EmailValidationError("createEmailClient plugins could not be read.", error);
  }

  for (const plugin of pluginList) {
    let pluginId: string;
    let rawPluginHooks: EmailHooks | undefined;
    let rawPluginMiddleware: readonly EmailSendMiddleware[] | undefined;
    let boundExtendClient: EmailPlugin["extendClient"];

    try {
      if (!isNonArrayObject(plugin)) {
        throw new EmailValidationError("Each email plugin must be an object with a non-empty id.");
      }

      const rawId = plugin.id;

      if (!isStringMember(rawId) || !rawId.trim()) {
        throw new EmailValidationError("Each email plugin must be an object with a non-empty id.");
      }

      pluginId = rawId;
      rawPluginHooks = plugin.hooks;
      rawPluginMiddleware = plugin.middleware;

      if (rawPluginMiddleware !== undefined) {
        if (!Array.isArray(rawPluginMiddleware)) {
          throw new EmailValidationError(`Plugin "${pluginId}" middleware must be an array.`);
        }

        const copiedMiddleware: EmailSendMiddleware[] = [];

        for (const entry of copyBoundedArray(
          rawPluginMiddleware,
          `Plugin "${pluginId}" middleware`,
        )) {
          if (!isNonArrayObject(entry)) {
            throw new EmailValidationError(
              `Plugin "${pluginId}" middleware entries must be objects.`,
            );
          }

          const beforeSend = entry.beforeSend;
          const afterSend = entry.afterSend;
          const onError = entry.onError;

          if (beforeSend !== undefined && !isFunction(beforeSend)) {
            throw new EmailValidationError(
              `Plugin "${pluginId}" middleware beforeSend must be a function.`,
            );
          }

          if (afterSend !== undefined && !isFunction(afterSend)) {
            throw new EmailValidationError(
              `Plugin "${pluginId}" middleware afterSend must be a function.`,
            );
          }

          if (onError !== undefined && !isFunction(onError)) {
            throw new EmailValidationError(
              `Plugin "${pluginId}" middleware onError must be a function.`,
            );
          }

          const item: EmailSendMiddleware = {};

          if (beforeSend) {
            // SAFETY: `beforeSend` is verified callable; binding via Function.prototype preserves its type.
            item.beforeSend = Function.prototype.bind.call(
              beforeSend,
              entry,
            ) as EmailSendMiddleware["beforeSend"];
          }

          if (afterSend) {
            // SAFETY: `afterSend` is verified callable; binding via Function.prototype preserves its type.
            item.afterSend = Function.prototype.bind.call(
              afterSend,
              entry,
            ) as EmailSendMiddleware["afterSend"];
          }

          if (onError) {
            // SAFETY: `onError` is verified callable; binding via Function.prototype preserves its type.
            item.onError = Function.prototype.bind.call(
              onError,
              entry,
            ) as EmailSendMiddleware["onError"];
          }

          copiedMiddleware.push(item);
        }

        rawPluginMiddleware = copiedMiddleware;
      }

      const extendClient = plugin.extendClient;

      if (extendClient !== undefined) {
        if (!isFunction(extendClient)) {
          throw new EmailValidationError(`Plugin "${pluginId}" extendClient must be a function.`);
        }

        // SAFETY: `extendClient` is verified callable; binding via Function.prototype preserves its type.
        boundExtendClient = Function.prototype.bind.call(
          extendClient,
          plugin,
        ) as EmailPlugin["extendClient"];
      }
    } catch (error) {
      if (error instanceof EmailSdkError) throw error;

      throw new EmailValidationError("createEmailClient plugins could not be read.", error);
    }

    if (pluginIds.has(pluginId)) {
      throw new EmailValidationError(`Duplicate email plugin "${pluginId}".`);
    }

    pluginIds.add(pluginId);

    const context = createPluginContext(adapters, requestedDefault);

    try {
      for (const adapter of copyBoundedArray(
        resolvePluginAdapters(plugin, context, pluginId),
        `Plugin "${pluginId}" adapters`,
      )) {
        if (!isNonArrayObject(adapter) || !isStringMember(adapter.name)) {
          throw new EmailValidationError(`Plugin "${pluginId}" returned an invalid email adapter.`);
        }

        if (adapters.get(adapter.name) !== adapter) context.addAdapter(adapter);
      }

      if (rawPluginHooks !== undefined) {
        pluginHooks.push(snapshotHooks(rawPluginHooks, `Plugin "${pluginId}" hooks`));
      }
    } catch (error) {
      if (error instanceof EmailSdkError) throw error;

      throw new EmailValidationError("createEmailClient plugins could not be read.", error);
    }

    if (rawPluginMiddleware) middleware.push(...rawPluginMiddleware);

    if (boundExtendClient) {
      extensionPlugins.push({ id: pluginId, extendClient: boundExtendClient });
    }
  }

  const defaultAdapter = rawDefaultAdapter ?? adapters.keys().next().value;

  if (!defaultAdapter) {
    throw new EmailValidationError("createEmailClient requires at least one adapter.");
  }

  requireAdapter(adapters, defaultAdapter);

  let clientRetry: EmailRetryConfig | undefined;
  let clientFallback: EmailClientOptions<TAdapters, TPlugins>["fallback"];
  let clientHooks: EmailHooks | undefined;

  try {
    clientRetry = snapshotRetryConfig(rawRetry);
    validateRetry(clientRetry);
    clientFallback = snapshotFallbackConfig(rawFallback);
    validateFallback(adapters, clientFallback);
    clientHooks =
      rawHooks !== undefined ? snapshotHooks(rawHooks, "createEmailClient hooks") : undefined;
  } catch (error) {
    if (error instanceof EmailSdkError) throw error;

    throw new EmailValidationError("createEmailClient options could not be read.", error);
  }

  // A telemetry instance that starts disabled never turns on again, so the client drops it and
  // every send skips building telemetry facts.
  const sharedTelemetry = rawTelemetry === false ? undefined : getTelemetry();
  const telemetry = sharedTelemetry?.enabled ? sharedTelemetry : undefined;
  const telemetrySource = getTelemetrySource();
  const hooks = [...pluginHooks, ...(clientHooks ? [clientHooks] : [])];

  const measureAttempt: MeasureAttempt = (adapter, path, recipients, invoke, native) => {
    if (!telemetry?.enabled) return invoke();

    return measureAttemptTelemetry(telemetry, adapter, path, recipients, invoke, native);
  };

  const measureAttemptTelemetry = async <T extends EmailSendResult>(
    telemetry: Telemetry,
    adapter: EmailAdapter,
    path: AttemptPath,
    recipients: number,
    invoke: () => T | PromiseLike<T>,
    native: EmailNativeObject | undefined,
  ): Promise<T> => {
    const { recipientsReplaced, validationOnly } = nativeAttemptFacts(native);
    const startedAt = Date.now();
    const adapterName = normalizeAdapterName(adapter.name);

    const adapterKind =
      isTestAdapter(adapter) || adapter.name === "memory"
        ? "test"
        : ["custom", "unknown"].includes(adapterName)
          ? "custom"
          : "provider";

    // A validation-only request reaches the provider but sends nothing, so it isn't provider volume.
    const provider =
      telemetry.realProviderVolume === true && adapterKind !== "test" && !validationOnly;

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

      let resultAccepted: number | undefined;
      let resultRejected: number | undefined;

      try {
        const acceptedList = result?.accepted;

        if (Array.isArray(acceptedList)) resultAccepted = acceptedList.length;
      } catch {
        resultAccepted = undefined;
      }

      try {
        const rejectedList = result?.rejected;

        if (Array.isArray(rejectedList)) resultRejected = rejectedList.length;
      } catch {
        resultRejected = undefined;
      }

      const counts = acceptanceCounts(
        resultAccepted ?? adapterError?.acceptedCount,
        resultRejected ?? adapterError?.rejectedCount,
        recipientsReplaced ? undefined : recipients,
        adapterError !== undefined,
      );

      const { accepted, rejected } = counts;
      const acceptedMessages = path === "personalized_native" ? accepted : Number(accepted > 0);

      const inferred =
        resolved && !recipientsReplaced && resultAccepted === undefined && resultRejected === undefined;

      const acceptanceBasis = counts.explicit
        ? "explicit"
        : inferred
          ? "inferred_from_success"
          : "unknown";

      const submittedRecipients = inferred ? recipients : accepted;

      const submittedMessages =
        path === "personalized_native" ? submittedRecipients : Number(submittedRecipients > 0);

      // A passthrough that replaced the recipients can send to more addresses than the message had.
      const attemptedRecipients =
        recipientsReplaced && counts.explicit ? accepted + rejected : recipients;

      const notSent = adapterError?.delivery === "not_sent" && accepted === 0;
      const unknownRecipients = notSent ? 0 : Math.max(0, attemptedRecipients - accepted - rejected);
      void telemetry.capture("email adapter attempted", {
        failure_kind: resolved ? undefined : classifyAttemptFailure(adapter.name, failure),
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
        attempted_recipient_count: attemptedRecipients,
        not_sent_recipient_count: notSent ? attemptedRecipients : 0,
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
      shouldRetry:
        shouldRetry && ((error, attempt) => callerOwned(() => shouldRetry(error, attempt))),
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
    plugin_count: pluginList.length,
    default_adapter: normalizeAdapterName(defaultAdapter),
    source: telemetrySource,
  });

  const markValidatorError = (adapter: EmailAdapter, cause: unknown): never => {
    if (!isBuiltInAdapter(adapter) && isObjectLike(cause)) callerErrors.add(cause);

    throw cause;
  };

  /**
   * Validates the message for every adapter on the route, in order. Built-in validators are
   * synchronous, so this returns undefined without allocating a promise unless an adapter's
   * validate() actually returns one; later adapters then wait for it.
   */
  const validateRoute = (
    message: EmailMessage,
    route: EmailRoute,
    operation: "send" | "personalized",
    sendOptions: EmailNativeSendOptions | undefined,
    from = 0,
  ): Promise<void> | undefined => {
    if (from === 0) assertMessage(message);

    for (let index = from; index < route.names.length; index += 1) {
      const name = route.names[index] ?? route.primary;
      const adapter = requireAdapter(adapters, name);

      if (operation === "send" && !isFunction(adapter.send)) {
        throw new EmailValidationError(`${adapter.name} adapter does not support send().`);
      }

      if (
        operation === "personalized" &&
        !isFunction(adapter.sendPersonalized) &&
        !isFunction(adapter.send)
      ) {
        throw new EmailValidationError(
          `${adapter.name} adapter does not support sendPersonalized() or send().`,
        );
      }

      validateCapabilities(adapter, message, operation, sendOptions);
      let pending: MaybePromise<void>;

      try {
        pending = adapter.validate?.(snapshotMessage(message), { adapter: name, operation });
      } catch (error) {
        return markValidatorError(adapter, error);
      }

      if (pending !== undefined) {
        return Promise.resolve(pending).then(
          () => validateRoute(message, route, operation, sendOptions, index + 1),
          (cause: unknown) => markValidatorError(adapter, cause),
        );
      }
    }

    return undefined;
  };

  const readBoundary = <Result>(run: () => Result, label: string): Result => {
    try {
      return run();
    } catch (error) {
      if (error instanceof EmailSdkError) throw error;

      throw new EmailValidationError(`${label} could not be read.`, error);
    }
  };

  const snapshotSendOptions = (raw: EmailNativeSendOptions | undefined): EmailNativeSendOptions | undefined => {
    if (raw === undefined) return undefined;

    return readBoundary(() => {
      if (!isNonArrayObject(raw)) {
        throw new EmailValidationError("Email send options must be an object.");
      }

      return cloneNestedSendOptions(raw);
    }, "Email send options");
  };

  const resolveCheckedRoute = (sendOptions: EmailNativeSendOptions | undefined) => {
    validateRetry(sendOptions?.retry);
    const route = resolveRoute(defaultAdapter, clientFallback, sendOptions);
    validateFallback(adapters, route.fallback);

    return route;
  };

  const validate = async (
    message: EmailMessage,
    sendOptions?: EmailNativeSendOptions,
  ): Promise<EmailValidationResult> => {
    const safeOptions = snapshotSendOptions(sendOptions);
    const route = readBoundary(() => resolveCheckedRoute(safeOptions), "Email send options");

    const safeMessage = readBoundary(
      () => (isNonArrayObject(message) ? snapshotMessage(message) : message),
      "Email message",
    );

    await validateRoute(safeMessage, route, "send", safeOptions);

    return { adapter: route.primary, warnings: [] };
  };

  const attemptedAdapters = new WeakMap<Error, string>();

  const send = async (
    message: EmailMessage,
    sendOptions?: EmailNativeSendOptions,
  ): Promise<EmailSendResult> => {
    const startedAt = Date.now();

    let facts: ReturnType<typeof messageFacts> | undefined = telemetry
      ? {
          recipients: 0,
          has_attachments: false,
          used_recipient_variables: false,
          used_send_at: false,
        }
      : undefined;

    let attemptedAdapter = defaultAdapter;

    try {
      const safeInitialOptions = snapshotSendOptions(sendOptions);

      if (safeInitialOptions?.adapter !== undefined) {
        attemptedAdapter = safeInitialOptions.adapter;
      }

      const initialMessage = readBoundary(() => {
        if (!isNonArrayObject(message)) {
          throw new EmailValidationError("Email message must be an object.");
        }

        return snapshotMessage(message);
      }, "Email message");

      if (telemetry) facts = messageFacts(initialMessage);

      const initialSignal = safeInitialOptions?.signal;
      readBoundary(() => throwIfAborted(initialSignal), "Email send options");

      const preparing = applyBeforeSendMiddleware(
        middleware,
        {
          message: initialMessage,
          options: safeInitialOptions,
        },
        (nextOptions) => {
          try {
            const nextAdapter = nextOptions?.adapter;

            if (nextAdapter !== undefined) attemptedAdapter = nextAdapter;
          } catch {
            // Keep the last known adapter so a throwing getter does not mask EmailMiddlewareError.
          }
        },
      );

      // The lifecycle helpers return a native promise only when there is work to wait for.
      const preparedRaw = preparing instanceof Promise ? await preparing : preparing;

      const prepared = {
        ...preparedRaw,
        message:
          middleware.length > 0
            ? readBoundary(
                () =>
                  isNonArrayObject(preparedRaw.message)
                    ? snapshotMessage(preparedRaw.message)
                    : preparedRaw.message,
                "Email message",
              )
            : preparedRaw.message,
      };

      const safePreparedOptions = snapshotSendOptions(prepared.options);
      attemptedAdapter = safePreparedOptions?.adapter ?? defaultAdapter;

      const preparedSignal = safePreparedOptions?.signal;
      readBoundary(() => throwIfAborted(preparedSignal ?? initialSignal), "Email send options");

      // Middleware such as defaultsPlugin can add or mutate recipients, attachments, or sendAt,
      // including in place, so recompute telemetry facts from the prepared message.
      if (facts) facts = messageFacts(prepared.message);

      const route = readBoundary(
        () => resolveCheckedRoute(safePreparedOptions),
        "Email send options",
      );

      attemptedAdapter = route.primary;
      const validating = validateRoute(prepared.message, route, "send", safePreparedOptions);

      if (validating) await validating;

      const retry = readBoundary(
        () => callerRetry(safePreparedOptions?.retry ?? clientRetry),
        "Email send options",
      );

      const failures: EmailAdapterError[] = [];

      for (const [index, name] of route.names.entries()) {
        attemptedAdapter = name;
        const adapter = requireAdapter(adapters, name);

        try {
          const result = await attemptAdapter({
            adapter,
            message: prepared.message,
            options: safePreparedOptions,
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

          await invokeErrorMiddleware(middleware, () => ({
            adapter: name,
            message: snapshotMessage(prepared.message),
            attempt: failureAttempt(error),
            metadata: safePreparedOptions?.metadata
              ? cloneMetadataRecord(safePreparedOptions.metadata)
              : undefined,
            error: cloneAdapterError(failure),
          }));

          await invokeHooks(hooks, "onError", () => ({
            adapter: name,
            message: snapshotMessage(prepared.message),
            attempt: failureAttempt(error),
            metadata: safePreparedOptions?.metadata
              ? cloneMetadataRecord(safePreparedOptions.metadata)
              : undefined,
            error: cloneAdapterError(failure),
          }));

          const hasNext = index < route.names.length - 1;

          if (!hasNext || !canFallback(failure, route.fallback)) break;
        }
      }

      throw new EmailRouteError(failures);
    } catch (error) {
      const normalized = normalizeOwnedError(error);
      attemptedAdapters.set(normalized, attemptedAdapter);

      if (facts) {
        captureSendFailure({
          telemetry,
          source: telemetrySource,
          startedAt,
          facts,
          adapter: attemptedAdapter,
          messageCount: 1,
          error: normalized,
          isSdkOwned,
        });
      }

      throw normalized;
    }
  };

  const sendMany = async (
    items: readonly NativeSendItem[],
    manyOptions?: EmailNativeSendManyOptions,
  ): Promise<readonly EmailSendSettledResult[]> => {
    readBoundary(() => {
      if (!Array.isArray(items)) {
        throw new EmailValidationError("sendMany items must be an array.");
      }
    }, "sendMany items");

    const startedAt = Date.now();
    let concurrency = 1;
    let sendOptions: EmailNativeSendOptions | undefined;

    if (manyOptions !== undefined) {
      try {
        if (!isNonArrayObject(manyOptions)) {
          throw new EmailValidationError("sendMany options must be an object.");
        }

        concurrency = manyOptions.concurrency ?? 1;
        const shared = cloneNestedSendOptions(manyOptions);
        // Keep "no shared options" as undefined, so items without options send exactly as before.
        sendOptions = Object.keys(shared).length === 0 ? undefined : shared;
      } catch (error) {
        if (error instanceof EmailSdkError) throw error;
        throw new EmailValidationError("sendMany options could not be read.", error);
      }
    }

    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new EmailValidationError(
        "sendMany concurrency must be an integer greater than or equal to 1.",
      );
    }

    const itemCount = readBoundary(() => items.length, "sendMany items");

    if (!Number.isSafeInteger(itemCount) || itemCount < 0 || itemCount > 1_000_000) {
      throw new EmailValidationError("sendMany items must be an array with a valid length.");
    }

    const results: EmailSendSettledResult[] = [];
    const usedAdapters = new Set<string>();
    let failed = 0;
    let firstErrorCode: string | undefined;
    let totalRecipients = 0;

    const itemSendOptions = (index: number, itemOptions: EmailNativeSendOptions | undefined) => {
      const safeItem = itemOptions ? cloneNestedSendOptions(itemOptions) : undefined;
      const merged = mergeSendOptions(sendOptions, safeItem);

      if (
        merged &&
        safeItem?.idempotencyKey === undefined &&
        isStringMember(sendOptions?.idempotencyKey) &&
        sendOptions.idempotencyKey.trim().length > 0
      ) {
        return {
          ...merged,
          idempotencyKey: `${sendOptions.idempotencyKey}:${index}`,
        };
      }

      return merged;
    };

    const settle = async (index: number, message: EmailMessage, item: NativeSendItem) => {
      let itemOptions: EmailNativeSendOptions | undefined;

      try {
        itemOptions = readBoundary(() => {
          const rawOptions = item.options;

          if (rawOptions !== undefined && !isNonArrayObject(rawOptions)) {
            throw new EmailValidationError("sendMany item options must be an object.");
          }

          return rawOptions;
        }, "sendMany item options");

        const resolvedOptions = readBoundary(
          () => itemSendOptions(index, itemOptions),
          "sendMany item options",
        );

        const result = await send(message, resolvedOptions);

        if (telemetry) usedAdapters.add(normalizeAdapterName(result.adapter));
        results[index] = { ok: true, index, result };
      } catch (error) {
        const normalized = normalizeOwnedError(error);

        if (telemetry) {
          const failedAdapter =
            attemptedAdapters.get(normalized) ??
            (normalized instanceof EmailRouteError
              ? normalized.failures.at(-1)?.adapter
              : normalized instanceof EmailAdapterError ||
                  normalized instanceof EmailAdapterNotFoundError
                ? normalized.adapter
                : undefined);

          let itemAdapter: string | undefined;

          try {
            itemAdapter =
              itemOptions !== undefined && isNonArrayObject(itemOptions)
                ? itemOptions.adapter
                : undefined;
          } catch {
            itemAdapter = undefined;
          }

          const adapter = failedAdapter ?? itemAdapter ?? sendOptions?.adapter ?? defaultAdapter;

          usedAdapters.add(normalizeAdapterName(adapter));
        }

        failed += 1;
        // With concurrency the first failure to settle may not be the lowest index.
        firstErrorCode ??= normalized.code;
        results[index] = { ok: false, index, error: normalized };
      }
    };

    // A bounded pool: each worker takes the next unsent index until none are left. With the
    // default concurrency of 1 this is the same ordered, one-at-a-time loop as before.
    let next = 0;

    type ItemMessageReadResult =
      | { ok: true; message: EmailMessage | undefined }
      | { ok: false; error: unknown };

    const readItemMessage = (item: (typeof items)[number] | undefined): ItemMessageReadResult => {
      try {
        if (item === undefined || !isNonArrayObject(item)) return { ok: true, message: undefined };
        const msg = item.message;

        return { ok: true, message: isNonArrayObject(msg) ? msg : undefined };
      } catch (error) {
        return { ok: false, error };
      }
    };

    const worker = async () => {
      while (next < itemCount) {
        const index = next;
        next += 1;
        let item: (typeof items)[number] | undefined;
        let msgResult: ItemMessageReadResult;

        try {
          item = items[index];
          msgResult = readItemMessage(item);
        } catch (error) {
          msgResult = { ok: false, error };
        }

        if (!msgResult.ok) {
          const normalized = normalizeOwnedError(
            msgResult.error instanceof EmailValidationError
              ? msgResult.error
              : new EmailValidationError("Email message could not be read.", msgResult.error),
          );

          if (telemetry) {
            let itemAdapter: string | undefined;

            try {
              const rawItemOptions = item && isNonArrayObject(item) ? item.options : undefined;

              itemAdapter =
                rawItemOptions !== undefined && isNonArrayObject(rawItemOptions)
                  ? rawItemOptions.adapter
                  : undefined;
            } catch {
              itemAdapter = undefined;
            }

            usedAdapters.add(
              normalizeAdapterName(itemAdapter ?? sendOptions?.adapter ?? defaultAdapter),
            );
          }

          failed += 1;
          firstErrorCode ??= normalized.code;
          results[index] = { ok: false, index, error: normalized };
        } else if (item && msgResult.message) {
          const msg = msgResult.message;
          let safeMsg: EmailMessage | undefined;
          let snapshotFailed = false;
          let snapshotError: unknown;

          try {
            safeMsg = snapshotMessage(msg);
          } catch (error) {
            snapshotFailed = true;
            snapshotError = error;
          }

          if (snapshotFailed) {
            const normalized = normalizeOwnedError(
              snapshotError instanceof EmailValidationError
                ? snapshotError
                : new EmailValidationError("Email message could not be read.", snapshotError),
            );

            if (telemetry) {
              let itemAdapter: string | undefined;

              try {
                const rawItemOptions = item.options;

                itemAdapter =
                  rawItemOptions !== undefined && isNonArrayObject(rawItemOptions)
                    ? rawItemOptions.adapter
                    : undefined;
              } catch {
                itemAdapter = undefined;
              }

              usedAdapters.add(
                normalizeAdapterName(itemAdapter ?? sendOptions?.adapter ?? defaultAdapter),
              );
            }

            failed += 1;
            firstErrorCode ??= normalized.code;
            results[index] = { ok: false, index, error: normalized };
          } else if (safeMsg) {
            if (telemetry) {
              totalRecipients += recipientCount(safeMsg);
            }

            await settle(index, safeMsg, item);
          }
        } else {
          const error = new EmailValidationError("sendMany item is missing a message.");
          failed += 1;
          firstErrorCode ??= error.code;
          results[index] = { ok: false, index, error };
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, itemCount) }, worker));

    if (!telemetry) return results;

    const adapter =
      usedAdapters.size === 0
        ? normalizeAdapterName(sendOptions?.adapter ?? defaultAdapter)
        : usedAdapters.size === 1
          ? [...usedAdapters][0]
          : "mixed";

    void telemetry.capture("email batch sent", {
      message_count: itemCount,
      measurement_schema_version: 2,
      measurement_scope: "batch_summary",
      succeeded: itemCount - failed,
      failed,
      recipients: totalRecipients,
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
    sendOptions?: EmailNativeSendOptions,
  ): Promise<EmailPersonalizedResult> => {
    const startedAt = Date.now();

    let facts: ReturnType<typeof personalizedFacts> | undefined = telemetry
      ? {
          recipients: 0,
          personalized_recipient_count: 0,
          has_attachments: false,
          used_recipient_variables: false,
          used_send_at: false,
        }
      : undefined;

    let attemptedAdapter = defaultAdapter;
    let deliveryPath = "personalized";

    try {
      const safeInitialOptions = snapshotSendOptions(sendOptions);

      if (safeInitialOptions?.adapter !== undefined) {
        attemptedAdapter = safeInitialOptions.adapter;
      }

      const safeInput = snapshotPersonalizedInputForSend(input);

      if (telemetry) facts = personalizedFacts(safeInput);
      readBoundary(() => validatePersonalizedInput(safeInput), "sendPersonalized input");
      const initialSignal = safeInitialOptions?.signal;
      readBoundary(() => throwIfAborted(initialSignal), "Email send options");

      const initialMessage = readBoundary(
        () => personalizedMiddlewareMessage(safeInput),
        "sendPersonalized input",
      );

      const prepared = await applyBeforeSendMiddleware(
        middleware,
        {
          message: initialMessage,
          options: safeInitialOptions,
        },
        (nextOptions) => {
          try {
            const nextAdapter = nextOptions?.adapter;

            if (nextAdapter !== undefined) attemptedAdapter = nextAdapter;
          } catch {
            // Keep the last known adapter so a throwing getter does not mask EmailMiddlewareError.
          }
        },
      );

      const safePreparedOptions = snapshotSendOptions(prepared.options);
      attemptedAdapter = safePreparedOptions?.adapter ?? defaultAdapter;

      // A slow beforeSend hook can outlive the caller's deadline; stop before validating or sending.
      const preparedSignal = safePreparedOptions?.signal;
      readBoundary(() => throwIfAborted(preparedSignal ?? initialSignal), "Email send options");

      const preparedInput =
        middleware.length > 0
          ? readBoundary(
              () =>
                withPersonalizedMessage(
                  safeInput,
                  isNonArrayObject(prepared.message)
                    ? snapshotMessage(prepared.message)
                    : prepared.message,
                ),
              "sendPersonalized input",
            )
          : safeInput;

      if (facts) facts = personalizedFacts(preparedInput);

      const route = readBoundary(
        () => resolveCheckedRoute(safePreparedOptions),
        "Email send options",
      );

      attemptedAdapter = route.primary;
      assertNativeKeepsRecipients(route.names, safePreparedOptions?.native);

      const expanded = readBoundary(
        () =>
          safeInput.recipients.map((recipient) => ({
            recipient,
            message: expandPersonalizedMessage(preparedInput, recipient.to, recipient.variables),
          })),
        "sendPersonalized input",
      );

      for (const { message } of expanded) {
        await validateRoute(message, route, "personalized", safePreparedOptions);
      }

      const routeFailures: EmailAdapterError[] = [];

      // The helpers pick per-send retry over the client's, so both are wrapped
      // and the choice between them is left alone.
      const attemptOptions = readBoundary(
        () =>
          safePreparedOptions && {
            ...safePreparedOptions,
            retry: callerRetry(safePreparedOptions.retry),
          },
        "Email send options",
      );

      const resolvedClientRetry = callerRetry(clientRetry);

      for (const [index, name] of route.names.entries()) {
        attemptedAdapter = name;
        const adapter = requireAdapter(adapters, name);
        const hasNativePersonalized = isFunction(adapter.sendPersonalized);
        deliveryPath = hasNativePersonalized ? "personalized_native" : "personalized_expanded";

        const result = hasNativePersonalized
          ? await attemptNativePersonalized(
              adapter,
              preparedInput,
              expanded[0]!.message,
              attemptOptions,
              resolvedClientRetry,
              hooks,
              middleware,
              measureAttempt,
            )
          : await attemptExpandedPersonalized(
              adapter,
              expanded,
              attemptOptions,
              resolvedClientRetry,
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

          const { failures: _failures, ...publicResult } = result;

          return publicResult;
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
      attemptedAdapters.set(normalized, attemptedAdapter);

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
    // A live read-only view: the type says ReadonlyMap, and a cast can no longer change routing.
    adapters: new ReadonlyMapView(adapters),
    defaultAdapter,
    validate(message: EmailMessage, sendOptions?: EmailNativeSendOptions) {
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

      const routeOptions = (value: EmailNativeSendOptions | undefined): EmailNativeSendOptions => {
        if (value === undefined) return { adapter: name };

        return readBoundary(() => {
          if (!isNonArrayObject(value)) {
            throw new EmailValidationError("Email send options must be an object.");
          }

          return { ...cloneNestedSendOptions(value), adapter: name };
        }, "Email send options");
      };

      const routeManyOptions = (value: EmailNativeSendManyOptions | undefined): EmailNativeSendManyOptions => {
        if (value === undefined) return { adapter: name };

        return readBoundary(() => {
          if (!isNonArrayObject(value)) {
            throw new EmailValidationError("sendMany options must be an object.");
          }

          const concurrency = value.concurrency;
          const base = cloneNestedSendOptions(value);

          return concurrency === undefined
            ? { ...base, adapter: name }
            : { ...base, adapter: name, concurrency };
        }, "sendMany options");
      };

      return {
        async validate(message: EmailMessage, sendOptions?: EmailNativeSendOptions) {
          return validate(message, routeOptions(sendOptions));
        },
        async send(message: EmailMessage, sendOptions?: EmailNativeSendOptions) {
          return send(message, routeOptions(sendOptions));
        },
        async sendMany(items: readonly NativeSendItem[], sendOptions?: EmailNativeSendManyOptions) {
          return sendMany(items, routeManyOptions(sendOptions));
        },
        async sendPersonalized(input: EmailPersonalizedInput, sendOptions?: EmailNativeSendOptions) {
          return sendPersonalized(input, routeOptions(sendOptions));
        },
      };
    },
  } as EmailClient<TAdapters, EmailPluginClientExtensions<TPlugins>>;

  for (const plugin of extensionPlugins) {
    const extension = plugin.extendClient?.(createPluginContext(adapters, defaultAdapter));

    if (extension !== undefined) {
      readBoundary(
        () => applyClientExtension(client, plugin.id, extension),
        `Plugin "${plugin.id}" extension`,
      );
    }
  }

  return client;
}
