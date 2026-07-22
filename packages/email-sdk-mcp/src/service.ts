import { randomBytes, createHash } from "node:crypto";

import {
  EmailAdapterError,
  EmailRouteError,
  EmailSdkError,
} from "@opencoredev/email-sdk";

import {
  APPROVAL_BODY_MAX_LENGTH,
  addressList,
  policyVersion,
  resolvePolicy,
  toMessage,
  validatePolicy,
  validationSummary,
} from "./policy.js";
import { ValidationStore, type ValidationRecord } from "./store.js";
import type {
  EmailMcpConfigurationStatus,
  EmailMcpFailure,
  EmailMcpMessageInput,
  EmailMcpSendResult,
  EmailMcpServerOptions,
  EmailMcpTelemetryEvent,
  EmailMcpValidationResult,
} from "./types.js";

export type EmailMcpApprovalResult =
  | "accept"
  | "decline"
  | "cancel"
  | "unavailable"
  | "timeout";

export type EmailMcpApprover = (
  record: Readonly<ValidationRecord>,
  signal: AbortSignal,
) => Promise<EmailMcpApprovalResult>;

export class EmailMcpService {
  readonly adapter: string;
  readonly sendEnabled: boolean;
  readonly approvalTimeoutMs: number;

  private readonly sender?: string;
  private readonly client?: EmailMcpServerOptions["client"];
  private readonly missingEnvironment: readonly string[];
  private readonly policy;
  private readonly currentPolicyVersion: string;
  private readonly now: () => number;
  private readonly createReference: () => string;
  private readonly store: ValidationStore;
  private readonly telemetry?: EmailMcpServerOptions["telemetry"];

  constructor(options: EmailMcpServerOptions) {
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(options.adapter)) {
      throw new Error("Email MCP adapter names must use lowercase letters, numbers, dots, dashes, or underscores.");
    }

    if ((options.missingEnvironment ?? []).some((name) => !/^[A-Z][A-Z0-9_]{0,99}$/.test(name))) {
      throw new Error("Email MCP missing-environment entries must be environment variable names.");
    }

    this.adapter = options.adapter;
    this.sender = options.sender;
    this.client = options.client;
    this.sendEnabled = options.sendEnabled === true;
    this.missingEnvironment = [...new Set(options.missingEnvironment ?? [])].sort();
    this.policy = resolvePolicy(options.policy);
    this.approvalTimeoutMs = this.policy.limits.approvalTimeoutMs;
    this.currentPolicyVersion = policyVersion(this.adapter, this.sender, this.policy);
    this.now = options.now ?? Date.now;
    this.createReference = options.createReference ?? (() => `emv_${randomBytes(24).toString("base64url")}`);
    this.store = new ValidationStore(this.policy.limits.maxPendingValidations, this.now);
    this.telemetry = options.telemetry;
  }

  configurationStatus(): EmailMcpConfigurationStatus {
    return {
      ok: true,
      adapter: this.adapter,
      configured: this.isConfigured(),
      sendEnabled: this.sendEnabled,
      missingEnvironment: this.missingEnvironment,
      policy: this.policy.limits,
    };
  }

  async validate(input: EmailMcpMessageInput): Promise<EmailMcpValidationResult> {
    const startedAt = this.now();
    const result = await this.performValidation(input);
    this.capture("validate", startedAt, result);
    return result;
  }

  private async performValidation(input: EmailMcpMessageInput): Promise<EmailMcpValidationResult> {
    if (!this.isConfigured() || !this.client || !this.sender) {
      return failure("configuration_error");
    }

    const message = toMessage(input, this.sender);

    if (!validatePolicy(message, this.policy)) {
      return failure("policy_denied");
    }

    try {
      const validation = await this.client.validate(message, this.sendOptions());

      if (validation.adapter !== this.adapter) {
        return failure("reference_mismatch");
      }

      const createdAt = this.now();
      const expiresAt = createdAt + this.policy.limits.validationTtlMs;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const reference = this.createReference();

        if (!/^emv_[A-Za-z0-9_-]{16,128}$/.test(reference)) {
          continue;
        }

        const record = this.store.create({
          reference,
          adapter: this.adapter,
          policyVersion: this.currentPolicyVersion,
          message,
          createdAt,
          expiresAt,
        });

        if (record) {
          return {
            ok: true,
            validationReference: record.reference,
            expiresAt: new Date(record.expiresAt).toISOString(),
            summary: validationSummary(this.adapter, record.message),
            warningCount: validation.warnings.length,
          };
        }
      }

      return failure("internal_error");
    } catch (error) {
      return safeFailure(error, this.adapter);
    }
  }

  async send(
    validationReference: string,
    approve: EmailMcpApprover,
    signal: AbortSignal,
  ): Promise<EmailMcpSendResult> {
    const startedAt = this.now();
    const result = await this.performSend(validationReference, approve, signal);
    this.capture("send", startedAt, result);
    return result;
  }

  private async performSend(
    validationReference: string,
    approve: EmailMcpApprover,
    signal: AbortSignal,
  ): Promise<EmailMcpSendResult> {
    if (!this.sendEnabled) {
      return failure("send_disabled");
    }

    if (!this.isConfigured() || !this.client) {
      return failure("configuration_error");
    }

    const started = this.store.beginApproval(
      validationReference,
      this.adapter,
      this.currentPolicyVersion,
    );

    if (!started.ok) {
      return failure(started.code);
    }

    const { record } = started;

    try {
      if (!validatePolicy(record.message, this.policy)) {
        this.store.finish(record, "failed");
        return failure("policy_denied");
      }

      const validation = await this.client.validate(record.message, this.sendOptions(signal));

      if (validation.adapter !== this.adapter) {
        this.store.finish(record, "failed");
        return failure("reference_mismatch");
      }
    } catch (error) {
      this.store.finish(record, "failed");
      return safeFailure(error, this.adapter);
    }

    const approval = await approve(record, signal);

    if (approval !== "accept") {
      this.store.finish(record, "failed");
      return failure(
        approval === "decline"
          ? "approval_declined"
          : approval === "cancel"
            ? "approval_cancelled"
            : approval === "timeout"
              ? "approval_timeout"
              : "approval_unavailable",
      );
    }

    if (!this.store.beginSending(record)) {
      return failure("reference_used");
    }

    try {
      const result = await this.client.send(
        record.message,
        this.sendOptions(signal, `email-mcp:${record.reference}`),
      );
      this.store.finish(record, "sent");

      return {
        ok: true,
        status: "sent",
        adapter: this.adapter,
        ...(result.id ? { receiptId: opaqueReceiptId(result.id) } : {}),
        acceptedCount: result.accepted?.length ?? 0,
        rejectedCount: result.rejected?.length ?? 0,
      };
    } catch (error) {
      const mapped = safeFailure(error, this.adapter);
      this.store.finish(record, mapped.delivery === "unknown" ? "outcome_unknown" : "failed");
      return mapped;
    }
  }

  approvalMessage(record: Readonly<ValidationRecord>): string {
    const message = record.message;
    return [
      "Approve one irreversible email send?",
      `Adapter: ${this.adapter}`,
      `From: ${String(message.from)}`,
      `To: ${addressList(message.to).join(", ")}`,
      `Cc: ${addressList(message.cc).join(", ") || "none"}`,
      `Bcc: ${addressList(message.bcc).join(", ") || "none"}`,
      `Reply-To: ${addressList(message.replyTo).join(", ") || "none"}`,
      `Subject: ${message.subject}`,
      "Attachments: 0",
      bodyApprovalSection("Text body", message.text),
      bodyApprovalSection("HTML body", message.html),
      "Approving sends this email immediately. This action cannot be undone.",
    ].join("\n");
  }

  private capture(
    operation: EmailMcpTelemetryEvent["operation"],
    startedAt: number,
    result: EmailMcpValidationResult | EmailMcpSendResult,
  ) {
    if (!this.telemetry) return;

    const event: EmailMcpTelemetryEvent = {
      operation,
      ok: result.ok,
      durationMs: Math.max(0, this.now() - startedAt),
      ...(!result.ok ? { errorCode: result.code } : {}),
    };

    try {
      void Promise.resolve(this.telemetry(event)).catch(() => undefined);
    } catch {
      // Telemetry is best-effort and must never affect MCP behavior.
    }
  }

  private isConfigured() {
    return Boolean(this.client && this.sender && this.missingEnvironment.length === 0);
  }

  private sendOptions(signal?: AbortSignal, idempotencyKey?: string) {
    return {
      adapter: this.adapter,
      fallback: { adapters: [], onUnknownDelivery: "stop" as const },
      retry: { maxAttempts: 1 },
      ...(signal ? { signal } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };
  }
}

function safeFailure(error: unknown, adapter: string): EmailMcpFailure {
  const adapterError =
    error instanceof EmailAdapterError
      ? error
      : error instanceof EmailRouteError
        ? error.failures.at(-1)
        : undefined;

  if (adapterError) {
    const delivery = adapterError.delivery;
    return {
      ok: false,
      code: error instanceof EmailRouteError ? "route_error" : "adapter_error",
      status: delivery === "unknown" ? "outcome_unknown" : "failed",
      adapter,
      ...(validHttpStatus(adapterError.status) ? { httpStatus: adapterError.status } : {}),
      retryable: adapterError.retryable,
      delivery,
    };
  }

  if (error instanceof EmailSdkError) {
    return failure(
      error.code === "validation_error"
        ? "validation_error"
        : error.code === "aborted"
          ? "aborted"
          : error.code === "route_error"
            ? "route_error"
            : "internal_error",
    );
  }

  return failure("internal_error");
}

function failure(code: EmailMcpFailure["code"]): EmailMcpFailure {
  return { ok: false, code };
}

function opaqueReceiptId(value: string): string {
  return `receipt_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function bodyApprovalSection(label: string, body: string | undefined): string {
  if (body === undefined) {
    return `${label}: not provided`;
  }

  return `${label} (${body.length}/${APPROVAL_BODY_MAX_LENGTH} chars):\n${body}`;
}

function validHttpStatus(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && (value ?? 0) >= 100 && (value ?? 0) <= 599;
}
