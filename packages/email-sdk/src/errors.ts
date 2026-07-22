export type EmailErrorCode =
  | "validation_error"
  | "adapter_not_found"
  | "adapter_error"
  | "route_error"
  | "all_recipients_failed"
  | "middleware_error"
  | "aborted";

export type EmailSdkErrorOptions = {
  code: EmailErrorCode;
  retryable?: boolean;
  cause?: unknown;
};

export class EmailSdkError extends Error {
  readonly code: EmailErrorCode;
  readonly retryable: boolean;

  constructor(message: string, options: EmailSdkErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "EmailSdkError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
  }
}

export type EmailAdapterErrorOptions = {
  adapter: string;
  status?: number;
  requestId?: string;
  retryable?: boolean;
  delivery?: "not_sent" | "unknown";
  cause?: unknown;
};

export class EmailAdapterError extends EmailSdkError {
  readonly adapter: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly delivery: "not_sent" | "unknown";

  constructor(message: string, options: EmailAdapterErrorOptions) {
    super(message, {
      code: "adapter_error",
      retryable: options.retryable,
      cause: options.cause,
    });
    this.name = "EmailAdapterError";
    this.adapter = options.adapter;
    this.status = options.status;
    this.requestId = options.requestId;
    this.delivery = options.delivery ?? "unknown";
  }
}

export class EmailValidationError extends EmailSdkError {
  constructor(message: string, cause?: unknown) {
    super(message, {
      code: "validation_error",
      cause,
    });
    this.name = "EmailValidationError";
  }
}

export class EmailAdapterNotFoundError extends EmailSdkError {
  readonly adapter: string;

  constructor(adapter: string) {
    super(`Email adapter "${adapter}" is not registered.`, {
      code: "adapter_not_found",
    });
    this.name = "EmailAdapterNotFoundError";
    this.adapter = adapter;
  }
}

export class EmailRouteError extends EmailSdkError {
  readonly failures: readonly EmailAdapterError[];

  constructor(failures: readonly EmailAdapterError[]) {
    super("All configured email adapters failed.", {
      code: "route_error",
      cause: failures.at(-1),
    });
    this.name = "EmailRouteError";
    this.failures = failures;
  }
}

export class EmailAllRecipientsFailedError extends EmailSdkError {
  readonly failures: readonly EmailAdapterError[];

  constructor(failures: readonly EmailAdapterError[]) {
    super("All personalized email recipients failed.", {
      code: "all_recipients_failed",
      cause: failures.at(-1),
    });
    this.name = "EmailAllRecipientsFailedError";
    this.failures = failures;
  }
}

export class EmailMiddlewareError extends EmailSdkError {
  readonly phase: "before_send" | "after_send" | "on_error";

  constructor(phase: "before_send" | "after_send" | "on_error", cause: unknown) {
    super(`Email middleware failed during ${phase.replaceAll("_", " ")}.`, {
      code: "middleware_error",
      cause,
    });
    this.name = "EmailMiddlewareError";
    this.phase = phase;
  }
}

export class EmailAbortError extends EmailSdkError {
  constructor(cause?: unknown) {
    super("Email sending was aborted.", {
      code: "aborted",
      cause,
    });
    this.name = "EmailAbortError";
  }
}

export function isRetryableEmailError(error: unknown): error is EmailSdkError {
  return error instanceof EmailSdkError && error.retryable;
}

/** @deprecated Internal migration bridge. Import EmailAdapterError from the package root. */
export class EmailProviderError extends EmailAdapterError {
  constructor(
    message: string,
    options: {
      provider?: string;
      adapter?: string;
      status?: number;
      requestId?: string;
      retryable?: boolean;
      delivery?: "not_sent" | "unknown";
      details?: unknown;
      cause?: unknown;
      code?: string;
    },
  ) {
    super(message, {
      adapter: options.adapter ?? options.provider ?? "unknown",
      status: options.status,
      requestId: options.requestId,
      retryable: options.retryable,
      delivery: options.delivery,
      cause: options.cause,
    });
    this.name = "EmailAdapterError";
  }

  /** @deprecated Use adapter. */
  get provider() {
    return this.adapter;
  }
}

/** @deprecated Internal migration bridge. Import EmailAdapterNotFoundError from the package root. */
export class EmailProviderNotFoundError extends EmailAdapterNotFoundError {
  constructor(provider: string) {
    super(provider);
    this.name = "EmailAdapterNotFoundError";
  }
}
