import type { EmailAdapterError, EmailSdkError } from "../errors.js";
import {
  getTelemetry,
  normalizeAdapterName,
  type TelemetrySource,
} from "../telemetry.js";
import type { EmailMessage, EmailPersonalizedInput, OneOrMany } from "../types.js";
import { classifySendFailure, findSdkDefect, type FailureKind } from "./failure-kind.js";

function listLength<T>(value: OneOrMany<T> | undefined) {
  if (value === undefined) return 0;

  return Array.isArray(value) ? value.length : 1;
}

/** to + cc + bcc, counted without copying the lists. */
export function recipientCount(message: EmailMessage) {
  return listLength(message.to) + listLength(message.cc) + listLength(message.bcc);
}

export function messageFacts(message: EmailMessage) {
  return {
    recipients: recipientCount(message),
    has_attachments: (message.attachments?.length ?? 0) > 0,
    used_recipient_variables: false,
    used_send_at: message.sendAt !== undefined,
  };
}

export function personalizedFacts(input: EmailPersonalizedInput) {
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

export type SendTelemetryInput = {
  telemetry: ReturnType<typeof getTelemetry> | undefined;
  source: string;
  startedAt: number;
  facts: ReturnType<typeof messageFacts> | ReturnType<typeof personalizedFacts>;
  adapter: string;
  success: boolean;
  /**
   * Individual messages this call represents: 1 for send() regardless of how many
   * to/cc/bcc addresses share it, one per recipient for sendPersonalized(). Counting
   * events instead would undercount a personalized send to 500 people as 1.
   */
  messageCount: number;
  errorCode?: string;
  failureKind?: FailureKind;
  deliveryPath?: string;
};

export function captureSendTelemetry({
  telemetry,
  source,
  startedAt,
  facts,
  adapter,
  success,
  messageCount,
  errorCode,
  failureKind,
  deliveryPath = "single",
}: SendTelemetryInput) {
  void telemetry?.capture("email sent", {
    ...facts,
    adapter: normalizeAdapterName(adapter),
    delivery_path: deliveryPath,
    success,
    duration_ms: Date.now() - startedAt,
    error_code: errorCode,
    failure_kind: failureKind,
    message_count: messageCount,
    measurement_schema_version: 2,
    measurement_scope: "logical_operation",
    logical_operation_count: 1,
    operation_success_count: Number(success),
    operation_failure_count: Number(!success),
    source,
  });
}

export type SendFailureTelemetryInput = Omit<
  SendTelemetryInput,
  "success" | "errorCode" | "failureKind" | "source"
> & {
  source: TelemetrySource;
  error: EmailSdkError;
  /** True when a failure came from SDK code rather than caller code. */
  isSdkOwned: (failure: EmailAdapterError) => boolean;
};

/**
 * Records a failed send, and reports it to error tracking only when one of its
 * adapter failures looks like an SDK defect. Provider, network, and caller
 * failures are counted on the `email sent` event and nowhere else.
 */
export function captureSendFailure({ error, isSdkOwned, ...input }: SendFailureTelemetryInput) {
  captureSendTelemetry({
    ...input,
    success: false,
    errorCode: error.code,
    failureKind: classifySendFailure(error),
  });

  const defect = input.telemetry ? findSdkDefect(error, isSdkOwned) : undefined;

  if (defect) {
    void input.telemetry?.captureException(defect, {
      source: input.source,
      handled: true,
      adapter: normalizeAdapterName(defect.adapter),
    });
  }
}
