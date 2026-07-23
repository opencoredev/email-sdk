import type { EmailSdkError } from "./errors.js";

export type MaybePromise<T> = T | Promise<T>;

export type EmailAddress =
  | string
  | {
      email: string;
      name?: string;
    };

export type OneOrMany<T> = T | readonly T[];

export type Rfc3339Timestamp =
  | `${string}Z`
  | `${string}+${string}:${string}`
  | `${string}-${string}:${string}`;

export type EmailAttachmentBase = {
  filename: string;
  contentType?: string;
  contentId?: string;
  disposition?: "attachment" | "inline";
};

export type EmailAttachment = EmailAttachmentBase &
  (
    | {
        content: string | Uint8Array | ArrayBuffer | Blob;
        path?: never;
        contentEncoding?: "raw" | "base64";
      }
    | {
        path: string;
        content?: never;
        contentEncoding?: never;
      }
  );

export type EmailHeader = {
  name: string;
  value: string;
};

export type EmailTag = {
  name: string;
  value: string;
};

/** @deprecated Internal compatibility shape used by legacy payload helpers. */
export type RecipientVariables = Record<string, Record<string, string | number | boolean>>;

export type EmailEnvelope = {
  from: EmailAddress;
  to: OneOrMany<EmailAddress>;
  subject: string;
  cc?: OneOrMany<EmailAddress>;
  bcc?: OneOrMany<EmailAddress>;
  replyTo?: OneOrMany<EmailAddress>;
  headers?: readonly EmailHeader[];
  attachments?: readonly EmailAttachment[];
  tags?: readonly EmailTag[];
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
  sendAt?: Date | Rfc3339Timestamp;
};

export type EmailMessage = EmailEnvelope &
  ({ html: string; text?: string } | { text: string; html?: string });

export type EmailAdapterCapabilities = {
  repeatedHeaders: boolean;
  idempotency: "native" | "message_id" | "none";
  scheduling: boolean;
  personalized: "native" | "expanded" | "unsupported";
};

export type EmailAdapterValidationContext = {
  adapter: string;
  operation: "send" | "personalized";
};

export type EmailAdapterContext = EmailAdapterValidationContext & {
  attempt: number;
  signal?: AbortSignal;
  idempotencyKey?: string;
  metadata?: Readonly<Record<string, unknown>>;
};

export type EmailSendResult<Name extends string = string, Raw = unknown> = {
  adapter: Name;
  id?: string;
  accepted?: readonly string[];
  rejected?: readonly string[];
  raw?: Raw;
};

export type EmailPersonalizedRecipient = {
  to: EmailAddress;
  variables: Readonly<Record<string, string | number | boolean>>;
};

export type EmailPersonalizedInput = {
  message: Omit<EmailMessage, "to" | "cc" | "bcc">;
  recipients: readonly EmailPersonalizedRecipient[];
};

export type EmailPersonalizedResult<Name extends string = string> = EmailSendResult<Name> & {
  accepted: readonly string[];
  rejected: readonly string[];
};

export type EmailAdapter<Name extends string = string, RawClient = unknown, RawResult = unknown> = {
  readonly name: Name;
  readonly capabilities: EmailAdapterCapabilities;
  readonly raw?: RawClient;
  validate?(message: EmailMessage, context: EmailAdapterValidationContext): MaybePromise<void>;
  send(
    message: EmailMessage,
    context: EmailAdapterContext,
  ): MaybePromise<EmailSendResult<Name, RawResult>>;
  sendPersonalized?(
    input: EmailPersonalizedInput,
    context: EmailAdapterContext,
  ): MaybePromise<EmailPersonalizedResult<Name>>;
};

export type EmailRetryConfig = {
  maxAttempts?: number;
  delay?: (attempt: number, error: EmailSdkError) => number;
  shouldRetry?: (error: EmailSdkError, attempt: number) => boolean;
};

export type EmailFallbackConfig<Name extends string = string> = {
  adapters: readonly Name[];
  onUnknownDelivery?: "stop" | "continue";
};

export type EmailSendOptions<Name extends string = string> = {
  adapter?: Name;
  fallback?: EmailFallbackConfig<Name>;
  retry?: EmailRetryConfig;
  signal?: AbortSignal;
  idempotencyKey?: string;
  metadata?: Readonly<Record<string, unknown>>;
};

export type EmailValidationWarning = {
  code: string;
  message: string;
};

export type EmailValidationResult<Name extends string = string> = {
  adapter: Name;
  warnings: readonly EmailValidationWarning[];
};

export type EmailSendItem<Name extends string = string> = {
  message: EmailMessage;
  options?: EmailSendOptions<Name>;
};

export type EmailSendSettledResult<Name extends string = string> =
  | { ok: true; index: number; result: EmailSendResult<Name> }
  | { ok: false; index: number; error: EmailSdkError };

export type EmailPluginContext = {
  adapters: ReadonlyMap<string, EmailAdapter>;
  defaultAdapter: string;
  addAdapter(adapter: EmailAdapter): void;
};

export type EmailBeforeSendEvent = {
  message: EmailMessage;
  options?: EmailSendOptions;
};

export type EmailBeforeSendResult = {
  message?: EmailMessage;
  options?: EmailSendOptions;
};

export type EmailHookEvent = {
  adapter: string;
  message: EmailMessage;
  attempt: number;
  metadata?: Readonly<Record<string, unknown>>;
};

export type EmailAfterSendEvent = EmailHookEvent & {
  response: EmailSendResult;
};

export type EmailErrorEvent = EmailHookEvent & {
  error: EmailSdkError;
};

export type EmailSendMiddleware = {
  beforeSend?: (event: EmailBeforeSendEvent) => MaybePromise<EmailBeforeSendResult | void>;
  afterSend?: (event: EmailAfterSendEvent) => MaybePromise<void>;
  onError?: (event: EmailErrorEvent) => MaybePromise<void>;
};

export type EmailHooks = {
  beforeSend?: (event: EmailHookEvent) => MaybePromise<void>;
  afterSend?: (event: EmailAfterSendEvent) => MaybePromise<void>;
  onError?: (event: EmailErrorEvent) => MaybePromise<void>;
  onRetry?: (
    event: EmailHookEvent & {
      error: EmailSdkError;
      nextAttempt: number;
      delayMs: number;
    },
  ) => MaybePromise<void>;
};

export type EmailPlugin<TExtension extends object = object> = {
  id: string;
  adapters?: EmailAdapter[] | ((ctx: EmailPluginContext) => EmailAdapter[]);
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

export type EmailClientOptions<
  TAdapters extends readonly EmailAdapter[] = readonly EmailAdapter[],
  TPlugins extends readonly EmailPlugin[] = readonly EmailPlugin[],
> = {
  adapters?: TAdapters;
  defaultAdapter?: TAdapters[number]["name"];
  fallback?: EmailFallbackConfig<TAdapters[number]["name"]>;
  retry?: EmailRetryConfig;
  hooks?: EmailHooks;
  plugins?: TPlugins;
  /**
   * Anonymous usage analytics. Defaults to enabled. Set `false` here or use
   * `EMAIL_SDK_TELEMETRY=0` / `DO_NOT_TRACK=1` to opt out.
   */
  telemetry?: boolean;
};

export type RouteName<Routes extends readonly EmailAdapter[]> = Routes[number]["name"];

export type AdapterForName<
  Routes extends readonly EmailAdapter[],
  Name extends RouteName<Routes>,
> = Extract<Routes[number], { name: Name }>;

export type EmailClient<
  Routes extends readonly EmailAdapter[] = readonly EmailAdapter[],
  Extension extends object = object,
> = {
  readonly adapters: ReadonlyMap<RouteName<Routes>, Routes[number]>;
  readonly defaultAdapter: RouteName<Routes>;
  validate(
    message: EmailMessage,
    options?: EmailSendOptions<RouteName<Routes>>,
  ): Promise<EmailValidationResult<RouteName<Routes>>>;
  send(
    message: EmailMessage,
    options?: EmailSendOptions<RouteName<Routes>>,
  ): Promise<EmailSendResult<RouteName<Routes>>>;
  sendMany(
    items: readonly EmailSendItem<RouteName<Routes>>[],
    options?: EmailSendOptions<RouteName<Routes>>,
  ): Promise<readonly EmailSendSettledResult<RouteName<Routes>>[]>;
  sendPersonalized(
    input: EmailPersonalizedInput,
    options?: EmailSendOptions<RouteName<Routes>>,
  ): Promise<EmailPersonalizedResult<RouteName<Routes>>>;
  adapter<Name extends RouteName<Routes>>(name: Name): AdapterForName<Routes, Name>;
  withAdapter<Name extends RouteName<Routes>>(
    name: Name,
  ): Pick<EmailClient<Routes>, "validate" | "send" | "sendMany" | "sendPersonalized">;
} & Extension;

/** @deprecated Internal migration alias. Import v1 names from the package root. */
export type EmailProvider<TRaw = unknown> = EmailAdapter<string, TRaw> & {
  sendBulk?(
    message: EmailMessage & {
      recipientVariables?: RecipientVariables;
      idempotencyKey?: string;
    },
    context: EmailAdapterContext,
  ): MaybePromise<EmailSendResult>;
};
/** @deprecated Internal migration alias. */
export type EmailProviderContext = EmailAdapterContext;
/** @deprecated Internal migration alias. */
export type EmailProviderResponse = EmailSendResult;
/** @deprecated Internal migration alias. */
export type SendOptions = EmailSendOptions & {
  provider?: string;
  fallbackAdapters?: readonly string[];
  fallbackProviders?: readonly string[];
  retries?: number;
};
/** @deprecated Internal migration alias. */
export type SendBatchItem = EmailSendItem;
/** @deprecated Internal migration alias. */
export type SendBatchResult = EmailSendSettledResult;
