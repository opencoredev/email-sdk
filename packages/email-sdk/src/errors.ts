export type EmailSdkErrorOptions = {
  code: string;
  provider?: string;
  status?: number;
  retryable?: boolean;
  details?: unknown;
  cause?: unknown;
};

export class EmailSdkError extends Error {
  readonly code: string;
  readonly provider?: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(message: string, options: EmailSdkErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "EmailSdkError";
    this.code = options.code;
    this.provider = options.provider;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export class EmailProviderError extends EmailSdkError {
  constructor(message: string, options: Omit<EmailSdkErrorOptions, "code"> & { code?: string }) {
    super(message, {
      code: options.code ?? "provider_error",
      provider: options.provider,
      status: options.status,
      retryable: options.retryable,
      details: options.details,
      cause: options.cause,
    });
    this.name = "EmailProviderError";
  }
}

export class EmailValidationError extends EmailSdkError {
  constructor(message: string, details?: unknown) {
    super(message, {
      code: "validation_error",
      retryable: false,
      details,
    });
    this.name = "EmailValidationError";
  }
}

export class EmailProviderNotFoundError extends EmailSdkError {
  constructor(provider: string) {
    super(`Email provider "${provider}" is not registered.`, {
      code: "provider_not_found",
      provider,
      retryable: false,
    });
    this.name = "EmailProviderNotFoundError";
  }
}

export function isRetryableEmailError(error: unknown) {
  if (error instanceof EmailSdkError) {
    return error.retryable;
  }

  return false;
}
