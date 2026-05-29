import type { EmailMessage, EmailPlugin, EmailProviderResponse } from "./types.js";

export type CapturedEmailEvent =
  | {
      type: "beforeSend";
      message: EmailMessage;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "afterSend";
      provider: string;
      attempt: number;
      message: EmailMessage;
      response: EmailProviderResponse;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "retry";
      provider: string;
      attempt: number;
      nextAttempt: number;
      delayMs: number;
      message: EmailMessage;
      error: unknown;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "error";
      provider: string;
      attempt: number;
      message: EmailMessage;
      error: unknown;
      metadata?: Record<string, unknown>;
    };

export type EmailCaptureStore = {
  readonly events: CapturedEmailEvent[];
  clear(): void;
};

export type EmailCapturePluginOptions = {
  id?: string;
  store?: EmailCaptureStore;
};

export function createEmailCaptureStore(): EmailCaptureStore {
  const events: CapturedEmailEvent[] = [];

  return {
    events,
    clear() {
      events.length = 0;
    },
  };
}

export function capturePlugin(
  optionsOrStore: EmailCaptureStore | EmailCapturePluginOptions = {},
): EmailPlugin<{ capture: EmailCaptureStore }> {
  const options = isCaptureStore(optionsOrStore) ? { store: optionsOrStore } : optionsOrStore;
  const store = options.store ?? createEmailCaptureStore();

  return {
    id: options.id ?? "capture",
    extendClient() {
      return { capture: store };
    },
    hooks: {
      onRetry(event) {
        store.events.push({
          type: "retry",
          provider: event.provider,
          attempt: event.attempt,
          nextAttempt: event.nextAttempt,
          delayMs: event.delayMs,
          message: event.message,
          error: event.error,
          metadata: event.metadata,
        });
      },
    },
    middleware: [
      {
        beforeSend(event) {
          store.events.push({
            type: "beforeSend",
            message: event.message,
            metadata: event.options?.metadata,
          });
        },
        afterSend(event) {
          store.events.push({
            type: "afterSend",
            provider: event.provider,
            attempt: event.attempt,
            message: event.message,
            response: event.response,
            metadata: event.metadata,
          });
        },
        onError(event) {
          store.events.push({
            type: "error",
            provider: event.provider,
            attempt: event.attempt,
            message: event.message,
            error: event.error,
            metadata: event.metadata,
          });
        },
      },
    ],
  };
}

function isCaptureStore(
  value: EmailCaptureStore | EmailCapturePluginOptions,
): value is EmailCaptureStore {
  return "events" in value && "clear" in value;
}
