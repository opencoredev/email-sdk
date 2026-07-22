import type {
  EmailMessage,
  EmailSendOptions,
  EmailSendResult,
  EmailValidationResult,
} from "@opencoredev/email-sdk";

export type EmailMcpMessageInput = {
  to: string | readonly string[];
  cc?: string | readonly string[];
  bcc?: string | readonly string[];
  replyTo?: string | readonly string[];
  subject: string;
  text?: string;
  html?: string;
};

export type EmailMcpClient = {
  validate(
    message: EmailMessage,
    options?: EmailSendOptions<string>,
  ): Promise<EmailValidationResult<string>>;
  send(
    message: EmailMessage,
    options?: EmailSendOptions<string>,
  ): Promise<EmailSendResult<string>>;
};

export type EmailMcpPolicyOptions = {
  allowedRecipients?: readonly string[];
  allowedDomains?: readonly string[];
  maxRecipients?: number;
  maxSubjectLength?: number;
  maxTextLength?: number;
  maxHtmlLength?: number;
  validationTtlMs?: number;
  maxPendingValidations?: number;
  approvalTimeoutMs?: number;
};

export type EmailMcpServerOptions = {
  adapter: string;
  sender?: string;
  client?: EmailMcpClient;
  sendEnabled?: boolean;
  missingEnvironment?: readonly string[];
  policy?: EmailMcpPolicyOptions;
  now?: () => number;
  createReference?: () => string;
  telemetry?: (event: EmailMcpTelemetryEvent) => void | Promise<void>;
};

export type EmailMcpTelemetryEvent = Readonly<{
  operation: "validate" | "send";
  ok: boolean;
  durationMs: number;
  errorCode?: EmailMcpErrorCode;
}>;

export type EmailMcpPolicyLimits = {
  maxRecipients: number;
  maxSubjectLength: number;
  maxTextLength: number;
  maxHtmlLength: number;
  validationTtlMs: number;
  maxPendingValidations: number;
  approvalTimeoutMs: number;
  recipientAllowlistConfigured: boolean;
  domainAllowlistConfigured: boolean;
};

export type EmailMcpConfigurationStatus = {
  ok: true;
  adapter: string;
  configured: boolean;
  sendEnabled: boolean;
  missingEnvironment: readonly string[];
  policy: EmailMcpPolicyLimits;
};

export type EmailMcpValidationSummary = {
  adapter: string;
  recipientCount: number;
  ccCount: number;
  bccCount: number;
  hasText: boolean;
  hasHtml: boolean;
  attachmentCount: 0;
};

export type EmailMcpValidationSuccess = {
  ok: true;
  validationReference: string;
  expiresAt: string;
  summary: EmailMcpValidationSummary;
  warningCount: number;
};

export type EmailMcpSendSuccess = {
  ok: true;
  status: "sent";
  adapter: string;
  receiptId?: string;
  acceptedCount: number;
  rejectedCount: number;
};

export type EmailMcpErrorCode =
  | "configuration_error"
  | "validation_error"
  | "policy_denied"
  | "reference_not_found"
  | "reference_expired"
  | "reference_used"
  | "reference_mismatch"
  | "approval_unavailable"
  | "approval_declined"
  | "approval_cancelled"
  | "approval_timeout"
  | "send_disabled"
  | "adapter_error"
  | "route_error"
  | "aborted"
  | "internal_error";

export type EmailMcpFailure = {
  ok: false;
  code: EmailMcpErrorCode;
  status?: "failed" | "outcome_unknown";
  adapter?: string;
  httpStatus?: number;
  retryable?: boolean;
  delivery?: "not_sent" | "unknown";
};

export type EmailMcpValidationResult = EmailMcpValidationSuccess | EmailMcpFailure;
export type EmailMcpSendResult = EmailMcpSendSuccess | EmailMcpFailure;
