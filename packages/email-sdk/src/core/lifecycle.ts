import { ReadonlyMapView } from "../internal/readonly-map.js";
import { EmailMiddlewareError, EmailValidationError } from "../errors.js";
import type {
  EmailAdapter,
  EmailAfterSendEvent,
  EmailBeforeSendEvent,
  EmailSendMetadata,
  EmailErrorEvent,
  EmailHookEvent,
  EmailHooks,
  EmailMessage,
  EmailPlugin,
  EmailPluginContext,
  EmailSendMiddleware,
  EmailSendOptions,
  MaybePromise,
} from "../types.js";
import { isNonArrayObject } from "../internal/decode.js";
import { addAdapter, cloneNestedSendOptions } from "./routing.js";

export function createPluginContext(
  adapters: Map<string, EmailAdapter>,
  defaultAdapter: string,
): EmailPluginContext {
  return {
    adapters: new ReadonlyMapView(adapters),
    defaultAdapter,
    addAdapter(adapter) {
      addAdapter(adapters, adapter);
    },
  };
}

export function resolvePluginAdapters(
  plugin: EmailPlugin,
  context: EmailPluginContext,
): EmailAdapter[] {
  const configured = plugin.adapters;

  if (!configured) return [];

  const adapters = Array.isArray(configured) ? configured : configured.call(plugin, context);

  // JavaScript callers can pass an async factory; its promise is the only non-array result.
  if (!Array.isArray(adapters)) {
    throw new EmailValidationError(
      `Email plugin "${plugin.id}" returned async adapters. createEmailClient requires synchronous plugin adapters.`,
    );
  }

  return adapters;
}

export function applyClientExtension<TClient extends object, TExtension extends object>(
  client: TClient,
  pluginId: string,
  extension: TExtension,
) {
  for (const key of Object.keys(extension)) {
    if (Object.hasOwn(client, key)) {
      throw new EmailValidationError(
        `Email plugin "${pluginId}" tried to extend the client with reserved key "${key}".`,
      );
    }
  }

  Object.assign(client, extension);
}

// The lifecycle helpers below return synchronously when there is nothing to run, so a client
// without plugins or hooks pays no promise allocation or microtask hop for them.

export function applyBeforeSendMiddleware(
  middleware: readonly EmailSendMiddleware[],
  event: EmailBeforeSendEvent,
  onOptions?: (options: EmailSendOptions | undefined) => void,
): MaybePromise<EmailBeforeSendEvent> {
  if (middleware.length === 0) return event;

  return runBeforeSendMiddleware(middleware, event, onOptions);
}

async function runBeforeSendMiddleware(
  middleware: readonly EmailSendMiddleware[],
  event: EmailBeforeSendEvent,
  onOptions?: (options: EmailSendOptions | undefined) => void,
): Promise<EmailBeforeSendEvent> {
  let message = event.message;
  let options = event.options;

  for (const item of middleware) {
    try {
      const result = await item.beforeSend?.({ message, options });

      if (result?.message) message = result.message;

      if (result?.options !== undefined) {
        if (!isNonArrayObject(result.options)) {
          throw new EmailValidationError("Email send options must be an object.");
        }

        const cloned = cloneNestedSendOptions(result.options);
        const merged: EmailSendOptions = { ...options, ...cloned };

        for (const key of [
          "adapter",
          "idempotencyKey",
          "idempotency",
          "signal",
          "retry",
          "fallback",
          "metadata",
        ] as const) {
          if (Object.hasOwn(result.options, key) && !(key in cloned)) {
            merged[key] = undefined;
          }
        }

        options = merged;
      }

      onOptions?.(options);
    } catch (error) {
      onOptions?.(options);
      throw new EmailMiddlewareError("before_send", error);
    }
  }

  return { message, options };
}

export function invokeAfterSendMiddleware(
  middleware: readonly EmailSendMiddleware[],
  event: EmailAfterSendEvent,
): Promise<void> | undefined {
  if (middleware.length === 0) return undefined;

  return runAfterSendMiddleware(middleware, event);
}

async function runAfterSendMiddleware(
  middleware: readonly EmailSendMiddleware[],
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

export function invokeErrorMiddleware(
  middleware: readonly EmailSendMiddleware[],
  event: EmailErrorEvent,
): Promise<void> | undefined {
  if (middleware.length === 0) return undefined;

  return runErrorMiddleware(middleware, event);
}

async function runErrorMiddleware(
  middleware: readonly EmailSendMiddleware[],
  event: EmailErrorEvent,
) {
  for (const item of middleware) {
    try {
      await item.onError?.(event);
    } catch (error) {
      throw new EmailMiddlewareError("on_error", error);
    }
  }
}

export async function invokeSendFailureLifecycle(
  middleware: readonly EmailSendMiddleware[],
  hooks: readonly EmailHooks[],
  event: EmailErrorEvent,
) {
  await invokeErrorMiddleware(middleware, event);
  await invokeHooks(hooks, "onError", event);
}

type EmailHookEvents = {
  [K in keyof EmailHooks]-?: Parameters<NonNullable<EmailHooks[K]>>[0];
};

/** EmailHooks keyed so a generic hook name selects a handler that accepts its own event. */
type EmailHookHandlers = {
  [K in keyof EmailHooks]?: (event: EmailHookEvents[K]) => MaybePromise<void>;
};

export function invokeHooks<K extends keyof EmailHooks>(
  hooks: readonly EmailHooks[],
  name: K,
  event: EmailHookEvents[K],
): Promise<void> | undefined {
  if (hooks.length === 0) return undefined;

  return runHooks(hooks, name, event);
}

async function runHooks<K extends keyof EmailHooks>(
  hooks: readonly EmailHooks[],
  name: K,
  event: EmailHookEvents[K],
) {
  for (const hook of hooks) {
    try {
      const handlers: EmailHookHandlers = hook;

      await handlers[name]?.(event);
    } catch {
      // Hooks are observability callbacks and never change delivery behavior.
    }
  }
}

export function hookEvent(
  adapter: string,
  message: EmailMessage,
  attempt: number,
  metadata: EmailSendMetadata | undefined,
): EmailHookEvent {
  return { adapter, message, attempt, metadata };
}
