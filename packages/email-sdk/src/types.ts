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

/**
 * Per-recipient substitution values, keyed by recipient email address. Reference
 * a value inside `subject`, `html`, or `text` with the `%recipient.key%` token.
 * Providers with a native batch mechanism (Mailgun, SendGrid) substitute these in
 * a single API call; other adapters fall back to one rendered send per recipient.
 */
export type RecipientVariables = Record<string, Record<string, string | number | boolean>>;

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
  recipientVariables?: RecipientVariables;
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
  /**
   * Optional native batch send for messages carrying `recipientVariables`. When
   * present, the client routes such messages here so the provider can personalize
   * every recipient in a single API call. Adapters without this method fall back to
   * one client-side rendered `send` per recipient.
   */
  sendBulk?(
    message: EmailMessage,
    context: EmailProviderContext,
  ): MaybePromise<EmailProviderResponse>;
  raw?: TRaw;
};

export type EmailPluginContext = {
  adapters: ReadonlyMap<string, EmailProvider>;
  defaultAdapter: string;
  addAdapter(adapter: EmailProvider): void;
};

export type EmailBeforeSendEvent = {
  message: EmailMessage;
  options?: SendOptions;
};

export type EmailBeforeSendResult = {
  message?: EmailMessage;
  options?: SendOptions;
};

export type EmailAfterSendEvent = EmailHookEvent & {
  response: EmailProviderResponse;
};

export type EmailErrorEvent = EmailHookEvent & {
  error: unknown;
};

export type EmailSendMiddleware = {
  beforeSend?: (event: EmailBeforeSendEvent) => MaybePromise<EmailBeforeSendResult | void>;
  afterSend?: (event: EmailAfterSendEvent) => MaybePromise<void>;
  onError?: (event: EmailErrorEvent) => MaybePromise<void>;
};

export type EmailPlugin<TExtension extends object = object> = {
  id: string;
  adapters?: EmailProvider[] | ((ctx: EmailPluginContext) => EmailProvider[]);
  hooks?: EmailHooks;
  middleware?: EmailSendMiddleware[];
  extendClient?: (ctx: EmailPluginContext) => TExtension;
};

export type EmailPluginClientExtension<TPlugin> =
  TPlugin extends EmailPlugin<infer TExtension> ? TExtension : object;

export type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer TIntersection,
) => void
  ? TIntersection
  : never;

export type EmailPluginClientExtensions<TPlugins extends readonly EmailPlugin[]> =
  UnionToIntersection<EmailPluginClientExtension<TPlugins[number]>> extends infer TExtension
    ? TExtension extends object
      ? TExtension
      : object
    : object;

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

export type EmailClientOptions<TPlugins extends readonly EmailPlugin[] = readonly EmailPlugin[]> = {
  adapters?: EmailProvider[];
  providers?: EmailProvider[];
  defaultAdapter?: string;
  defaultProvider?: string;
  fallback?: string[];
  retry?: EmailRetryConfig;
  hooks?: EmailHooks;
  plugins?: TPlugins;
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

export type EmailClient<TExtension extends object = object> = {
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
} & TExtension;
