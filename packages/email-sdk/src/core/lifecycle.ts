import { ReadonlyMapView } from "../internal/readonly-map.js";
import { EmailAdapterError, EmailMiddlewareError, EmailValidationError } from "../errors.js";
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
  EmailNativeSendOptions,
  MaybePromise,
} from "../types.js";
import { isFunction, isNonArrayObject } from "../internal/decode.js";
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
  pluginId?: string,
): EmailAdapter[] {
  const configured = plugin.adapters;

  if (configured === undefined) return [];

  let adapters: unknown;

  if (Array.isArray(configured)) {
    adapters = configured;
  } else if (isFunction(configured)) {
    adapters = Function.prototype.call.call(configured, plugin, context);
  } else {
    throw new EmailValidationError(
      `Email plugin "${pluginId ?? plugin.id}" adapters must be an array or function.`,
    );
  }

  // JavaScript callers can pass an async factory; its promise is the only non-array result.
  if (!Array.isArray(adapters)) {
    throw new EmailValidationError(
      `Email plugin "${pluginId ?? plugin.id}" returned async adapters. createEmailClient requires synchronous plugin adapters.`,
    );
  }

  return adapters;
}

export function applyClientExtension<TClient extends object, TExtension extends object>(
  client: TClient,
  pluginId: string,
  extension: TExtension,
) {
  if (!isNonArrayObject(extension)) {
    throw new EmailValidationError(
      `Email plugin "${pluginId}" extendClient must return an object.`,
    );
  }

  const entries = Object.entries(extension);

  for (const [key] of entries) {
    if (Object.hasOwn(client, key)) {
      throw new EmailValidationError(
        `Email plugin "${pluginId}" tried to extend the client with reserved key "${key}".`,
      );
    }
  }

  for (const [key, value] of entries) {
    Object.defineProperty(client, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}

// The lifecycle helpers below return synchronously when there is nothing to run, so a client
// without plugins or hooks pays no promise allocation or microtask hop for them.

export function applyBeforeSendMiddleware(
  middleware: readonly EmailSendMiddleware[],
  event: EmailBeforeSendEvent,
  onOptions?: (options: EmailNativeSendOptions | undefined) => void,
): MaybePromise<EmailBeforeSendEvent> {
  if (middleware.length === 0) return event;

  return runBeforeSendMiddleware(middleware, event, onOptions);
}

async function runBeforeSendMiddleware(
  middleware: readonly EmailSendMiddleware[],
  event: EmailBeforeSendEvent,
  onOptions?: (options: EmailNativeSendOptions | undefined) => void,
): Promise<EmailBeforeSendEvent> {
  let message = event.message;
  let options = event.options;

  for (const item of middleware) {
    try {
      const result = await item.beforeSend?.({ message, options });

      if (result !== undefined && !isNonArrayObject(result)) {
        throw new EmailValidationError("beforeSend middleware must return an object or undefined.");
      }

      const nextMessage = result?.message;
      const nextOptions = result?.options;

      if (nextMessage !== undefined) {
        if (!isNonArrayObject(nextMessage)) {
          throw new EmailValidationError("Email message must be an object.");
        }

        message = nextMessage;
      }

      if (nextOptions !== undefined) {
        if (!isNonArrayObject(nextOptions)) {
          throw new EmailValidationError("Email send options must be an object.");
        }

        // A fresh object per middleware, never the caller's options. The clone keeps own keys set
        // to undefined, so middleware can still clear a setting.
        const merged: EmailNativeSendOptions = { ...options, ...cloneNestedSendOptions(nextOptions) };

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

export function cloneAdapterError(error: EmailAdapterError): EmailAdapterError {
  const copy = new EmailAdapterError(error.message, {
    adapter: error.adapter,
    status: error.status,
    requestId: error.requestId,
    retryable: error.retryable,
    delivery: error.delivery,
    acceptedCount: error.acceptedCount,
    rejectedCount: error.rejectedCount,
    cause: error.cause,
  });

  copy.stack = error.stack;

  return copy;
}

export function invokeAfterSendMiddleware(
  middleware: readonly EmailSendMiddleware[],
  createEvent: () => EmailAfterSendEvent,
): Promise<void> | undefined {
  if (middleware.length === 0) return undefined;

  return runAfterSendMiddleware(middleware, createEvent);
}

async function runAfterSendMiddleware(
  middleware: readonly EmailSendMiddleware[],
  createEvent: () => EmailAfterSendEvent,
) {
  for (const item of middleware) {
    if (!item.afterSend) continue;

    try {
      await item.afterSend(createEvent());
    } catch (error) {
      throw new EmailMiddlewareError("after_send", error);
    }
  }
}

export function invokeErrorMiddleware(
  middleware: readonly EmailSendMiddleware[],
  createEvent: () => EmailErrorEvent,
): Promise<void> | undefined {
  if (middleware.length === 0) return undefined;

  return runErrorMiddleware(middleware, createEvent);
}

async function runErrorMiddleware(
  middleware: readonly EmailSendMiddleware[],
  createEvent: () => EmailErrorEvent,
) {
  for (const item of middleware) {
    if (!item.onError) continue;

    try {
      await item.onError(createEvent());
    } catch (error) {
      throw new EmailMiddlewareError("on_error", error);
    }
  }
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
  createEvent: () => EmailHookEvents[K],
): Promise<void> | undefined {
  if (hooks.length === 0) return undefined;

  return runHooks(hooks, name, createEvent);
}

async function runHooks<K extends keyof EmailHooks>(
  hooks: readonly EmailHooks[],
  name: K,
  createEvent: () => EmailHookEvents[K],
) {
  for (const hook of hooks) {
    try {
      const handlers: EmailHookHandlers = hook;
      const handler = handlers[name];

      if (!handler) continue;

      await handler(createEvent());
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
