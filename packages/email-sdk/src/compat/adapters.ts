import type {
  EmailAdapter as V1EmailAdapter,
  EmailAdapterContext,
  EmailHooks as V1EmailHooks,
  EmailHookEvent as V1EmailHookEvent,
  EmailPlugin as V1EmailPlugin,
  EmailPluginContext as V1EmailPluginContext,
  EmailSendMiddleware as V1EmailSendMiddleware,
} from "../types.js";
import { normalizeAdapterResult } from "../utils.js";
import type {
  EmailHookEvent,
  EmailHooks,
  EmailMessage,
  EmailPlugin,
  EmailPluginContext,
  EmailProvider,
  EmailProviderContext,
  EmailSendMiddleware,
  LegacyEmailAdapter,
} from "../compat.js";
import {
  mailbox,
  toLegacyBulkMessage,
  toLegacyMessage,
  toLegacyOptions,
  toPersonalizedInput,
  toV1Message,
  toV1Options,
  withLegacyResult,
} from "./messages.js";
import { warnOnce } from "./warn.js";

export function toV1Adapter(adapter: LegacyEmailAdapter): V1EmailAdapter {
  if ("capabilities" in adapter) return adapter;
  warnOnce("legacy-adapter", `Adapter "${adapter.name}" should declare v1 capabilities.`);

  const v1Adapter: V1EmailAdapter = {
    name: adapter.name,
    capabilities: {
      repeatedHeaders: true,
      idempotency: "native",
      scheduling: true,
      personalized: adapter.sendBulk ? "native" : "expanded",
    },
    raw: adapter.raw,
    async send(message, context) {
      return normalizeAdapterResult(
        adapter.name,
        await adapter.send(toLegacyMessage(message), toLegacyProviderContext(context)),
      );
    },
  };

  if (adapter.sendBulk) {
    v1Adapter.sendPersonalized = async (input, context) => {
      const result = normalizeAdapterResult(
        adapter.name,
        await adapter.sendBulk!(toLegacyBulkMessage(input), toLegacyProviderContext(context)),
      );

      return {
        ...result,
        accepted: result.accepted ?? input.recipients.map((recipient) => mailbox(recipient.to)),
        rejected: result.rejected ?? [],
      };
    };
  }

  return v1Adapter;
}

export function toV1Plugin(plugin: EmailPlugin): V1EmailPlugin {
  const pluginAdapters = plugin.adapters;

  const adapters = Array.isArray(pluginAdapters)
    ? pluginAdapters.map(toV1Adapter)
    : pluginAdapters
      ? (context: V1EmailPluginContext) =>
          pluginAdapters(toLegacyPluginContext(context)).map(toV1Adapter)
      : undefined;

  return {
    id: plugin.id,
    adapters,
    hooks: plugin.hooks ? toV1Hooks(plugin.hooks) : undefined,
    middleware: plugin.middleware?.map(toV1Middleware),
    extendClient: plugin.extendClient
      ? (context) => plugin.extendClient!(toLegacyPluginContext(context))
      : undefined,
  };
}

export function toV1Hooks(hooks: EmailHooks): V1EmailHooks {
  return {
    beforeSend: hooks.beforeSend
      ? (event) => hooks.beforeSend!(toLegacyHookEvent(event))
      : undefined,
    afterSend: hooks.afterSend
      ? (event) =>
          hooks.afterSend!({
            ...toLegacyHookEvent(event),
            response: withLegacyResult(event.response),
          })
      : undefined,
    onError: hooks.onError
      ? (event) => hooks.onError!({ ...toLegacyHookEvent(event), error: event.error })
      : undefined,
    onRetry: hooks.onRetry
      ? (event) =>
          hooks.onRetry!({
            ...toLegacyHookEvent(event),
            error: event.error,
            nextAttempt: event.nextAttempt,
            delayMs: event.delayMs,
          })
      : undefined,
  };
}

export function toV1Middleware(middleware: EmailSendMiddleware): V1EmailSendMiddleware {
  return {
    beforeSend: middleware.beforeSend
      ? async (event) => {
          const message = toLegacyMessage(event.message);

          const result = await middleware.beforeSend!({
            message,
            options: toLegacyOptions(event.options),
          });

          if (!result) return undefined;

          return {
            message: result.message ? toV1Message(result.message) : undefined,
            options: result.options
              ? toV1Options(result.message ?? message, result.options)
              : undefined,
          };
        }
      : undefined,
    afterSend: middleware.afterSend
      ? (event) =>
          middleware.afterSend!({
            ...toLegacyHookEvent(event),
            response: withLegacyResult(event.response),
          })
      : undefined,
    onError: middleware.onError
      ? (event) => middleware.onError!({ ...toLegacyHookEvent(event), error: event.error })
      : undefined,
  };
}

export function toLegacyPluginContext(context: V1EmailPluginContext): EmailPluginContext {
  return {
    adapters: new Map(
      [...context.adapters].map(([name, adapter]) => [name, toLegacyProvider(adapter)]),
    ),
    defaultAdapter: context.defaultAdapter,
    addAdapter(adapter) {
      context.addAdapter(toV1Adapter(adapter));
    },
  };
}

export function toLegacyHookEvent(event: V1EmailHookEvent): EmailHookEvent {
  return {
    provider: event.adapter,
    message: toLegacyMessage(event.message),
    attempt: event.attempt,
    metadata: event.metadata ? { ...event.metadata } : undefined,
  };
}

export function toLegacyProviderContext(context: EmailAdapterContext): EmailProviderContext {
  return {
    signal: context.signal,
    idempotencyKey: context.idempotencyKey,
    attempt: context.attempt,
    metadata: context.metadata ? { ...context.metadata } : undefined,
  };
}

export function toLegacyProvider(adapter: V1EmailAdapter): EmailProvider {
  const provider: EmailProvider = {
    name: adapter.name,
    raw: adapter.raw,
    async send(message, context) {
      return withLegacyResult(
        normalizeAdapterResult(
          adapter.name,
          await adapter.send(toV1Message(message), {
            adapter: adapter.name,
            operation: "send",
            ...context,
          }),
        ),
      );
    },
  };

  const sendPersonalized = adapter.sendPersonalized;

  if (sendPersonalized) {
    provider.sendBulk = async (message: EmailMessage, context: EmailProviderContext) => {
      const result = await sendPersonalized(toPersonalizedInput(message), {
        adapter: adapter.name,
        operation: "personalized",
        ...context,
      });

      return withLegacyResult(normalizeAdapterResult(adapter.name, result));
    };
  }

  return provider;
}
