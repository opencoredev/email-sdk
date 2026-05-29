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
      provider: string;
      attempt: number;
      message: RedactedEmailMessage;
      responseId?: string;
      messageId?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "email.retry";
      provider: string;
      attempt: number;
      nextAttempt: number;
      delayMs: number;
      message: RedactedEmailMessage;
      error: unknown;
      metadata?: Record<string, unknown>;
    }
  | {
      type: "email.error";
      provider: string;
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
    await options.log?.(event);
    await options.metric?.(event);
    await options.trace?.(event);
  };

  const redactMessage = options.redactMessage ?? defaultRedactMessage;

  return {
    id: options.id ?? "observability",
    hooks: {
      async onRetry(event) {
        await emit({
          type: "email.retry",
          provider: event.provider,
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
            provider: event.provider,
            attempt: event.attempt,
            message: redactMessage(event.message),
            responseId: event.response.id,
            messageId: event.response.messageId,
            metadata: event.metadata,
          });
        },
        async onError(event: EmailErrorEvent) {
          await emit({
            type: "email.error",
            provider: event.provider,
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
