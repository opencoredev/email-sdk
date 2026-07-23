import type {
  EmailAfterSendEvent,
  EmailErrorEvent,
  EmailMessage,
  EmailPlugin,
  MaybePromise,
} from "./types.js";

export type EmailObservabilityEvent =
  | {
      type: "email.sent";
      adapter: string;
      attempt: number;
      message: RedactedEmailMessage;
      responseId?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "email.retry";
      adapter: string;
      attempt: number;
      nextAttempt: number;
      delayMs: number;
      message: RedactedEmailMessage;
      error: unknown;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "email.error";
      adapter: string;
      attempt: number;
      message: RedactedEmailMessage;
      error: unknown;
      metadata?: Record<string, unknown>;
    };

export type RedactedEmailMessage = {
  subject: string;
  toCount: number;
  ccCount: number;
  bccCount: number;
  hasHtml: boolean;
  hasText: boolean;
  attachmentCount: number;
  tagNames: string[];
  metadataKeys: string[];
};

export type EmailObservabilityPluginOptions = {
  id?: string;
  log?: (event: EmailObservabilityEvent) => MaybePromise<void>;
  metric?: (event: EmailObservabilityEvent) => MaybePromise<void>;
  trace?: (event: EmailObservabilityEvent) => MaybePromise<void>;
  redactMessage?: (message: EmailMessage) => RedactedEmailMessage;
};

export function observabilityPlugin(options: EmailObservabilityPluginOptions): EmailPlugin {
  const emit = async (event: EmailObservabilityEvent) => {
    await Promise.allSettled([
      callObserver(() => options.log?.(event)),
      callObserver(() => options.metric?.(event)),
      callObserver(() => options.trace?.(event)),
    ]);
  };

  const redactMessage = options.redactMessage ?? defaultRedactMessage;

  return {
    id: options.id ?? "observability",
    hooks: {
      async onRetry(event) {
        await emit({
          type: "email.retry",
          adapter: event.adapter,
          attempt: event.attempt,
          nextAttempt: event.nextAttempt,
          delayMs: event.delayMs,
          message: redactMessage(event.message),
          error: event.error,
          metadata: event.metadata,
        });
      },
    },
    middleware: [
      {
        async afterSend(event: EmailAfterSendEvent) {
          await emit({
            type: "email.sent",
            adapter: event.adapter,
            attempt: event.attempt,
            message: redactMessage(event.message),
            responseId: event.response.id,
            metadata: event.metadata,
          });
        },
        async onError(event: EmailErrorEvent) {
          await emit({
            type: "email.error",
            adapter: event.adapter,
            attempt: event.attempt,
            message: redactMessage(event.message),
            error: event.error,
            metadata: event.metadata,
          });
        },
      },
    ],
  };
}

async function callObserver(callback: () => MaybePromise<void> | undefined) {
  return callback();
}

function defaultRedactMessage(message: EmailMessage): RedactedEmailMessage {
  return {
    subject: message.subject,
    toCount: countAddresses(message.to),
    ccCount: countAddresses(message.cc),
    bccCount: countAddresses(message.bcc),
    hasHtml: Boolean(message.html),
    hasText: Boolean(message.text),
    attachmentCount: message.attachments?.length ?? 0,
    tagNames: message.tags?.map((tag) => tag.name) ?? [],
    metadataKeys: Object.keys(message.metadata ?? {}),
  };
}

function countAddresses(value: EmailMessage["to"] | undefined) {
  if (!value) {
    return 0;
  }

  return Array.isArray(value) ? value.length : 1;
}
