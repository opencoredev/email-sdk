export type MaybePromise<T> = T | Promise<T>;

export type EmailAddress =
  | string
  | {
      email: string;
      name?: string;
    };

export type OneOrMany<T> = T | T[];

export type EmailAttachment = {
  filename: string;
  content?: string | Uint8Array | ArrayBuffer | Blob;
  contentEncoding?: "raw" | "base64";
  path?: string;
  contentType?: string;
  contentId?: string;
  disposition?: "attachment" | "inline";
};

export type EmailHeader = {
  name: string;
  value: string;
};

export type EmailTag = {
  name: string;
  value: string;
};

export type EmailMessage = {
  from: EmailAddress;
  to: OneOrMany<EmailAddress>;
  subject: string;
  html?: string;
  text?: string;
  cc?: OneOrMany<EmailAddress>;
  bcc?: OneOrMany<EmailAddress>;
  replyTo?: OneOrMany<EmailAddress>;
  headers?: Record<string, string> | EmailHeader[];
  attachments?: EmailAttachment[];
  tags?: EmailTag[];
  metadata?: Record<string, string | number | boolean | null>;
  idempotencyKey?: string;
};

export type SendOptions = {
  adapter?: string;
  provider?: string;
  fallbackAdapters?: string[];
  fallbackProviders?: string[];
  retries?: number;
  signal?: AbortSignal;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
};

export type EmailProviderResponse = {
  id?: string;
  provider: string;
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
  raw?: unknown;
};

export type EmailProviderContext = {
  signal?: AbortSignal;
  idempotencyKey?: string;
  attempt: number;
  metadata?: Record<string, unknown>;
};

export type EmailProvider<TRaw = unknown> = {
  name: string;
  send(message: EmailMessage, context: EmailProviderContext): MaybePromise<EmailProviderResponse>;
  raw?: TRaw;
};

export type EmailRetryConfig = {
  retries?: number;
  delay?: (attempt: number, error: unknown) => number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

export type EmailHooks = {
  beforeSend?: (event: EmailHookEvent) => MaybePromise<void>;
  afterSend?: (event: EmailHookEvent & { response: EmailProviderResponse }) => MaybePromise<void>;
  onError?: (event: EmailHookEvent & { error: unknown }) => MaybePromise<void>;
  onRetry?: (
    event: EmailHookEvent & { error: unknown; nextAttempt: number; delayMs: number },
  ) => MaybePromise<void>;
};

export type EmailHookEvent = {
  provider: string;
  message: EmailMessage;
  attempt: number;
  metadata?: Record<string, unknown>;
};

export type EmailClientOptions = {
  adapters?: EmailProvider[];
  providers?: EmailProvider[];
  defaultAdapter?: string;
  defaultProvider?: string;
  fallback?: string[];
  retry?: EmailRetryConfig;
  hooks?: EmailHooks;
};

export type SendBatchItem = EmailMessage & {
  adapter?: string;
  provider?: string;
  fallbackAdapters?: string[];
  fallbackProviders?: string[];
};

export type SendBatchResult =
  | {
      ok: true;
      index: number;
      response: EmailProviderResponse;
    }
  | {
      ok: false;
      index: number;
      error: unknown;
    };

export type EmailClient = {
  readonly adapters: ReadonlyMap<string, EmailProvider>;
  readonly providers: ReadonlyMap<string, EmailProvider>;
  readonly defaultAdapter: string;
  readonly defaultProvider: string;
  send(message: EmailMessage, options?: SendOptions): Promise<EmailProviderResponse>;
  sendBatch(messages: SendBatchItem[], options?: SendOptions): Promise<SendBatchResult[]>;
  adapter<TProvider extends EmailProvider = EmailProvider>(name: string): TProvider;
  provider<TProvider extends EmailProvider = EmailProvider>(name: string): TProvider;
  withAdapter(name: string): Pick<EmailClient, "send" | "sendBatch">;
  withProvider(name: string): Pick<EmailClient, "send" | "sendBatch">;
};
