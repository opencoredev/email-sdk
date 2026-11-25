import type { EmailSdkError } from "./errors.js";

export type MaybePromise<T> = T | Promise<T>;

export type EmailMetadataValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | readonly EmailMetadataValue[]
  | { readonly [key: string]: EmailMetadataValue };

export type EmailMetadataRecord = { readonly [key: string]: EmailMetadataValue };

/**
 * Augment this interface to give send-option metadata your own shape. The SDK clones plain
 * objects, null-prototype chains, arrays, and built-in value types per hook, middleware item,
 * and adapter attempt while passing custom class instances by reference.
 *
 * ```ts
 * import "@opencoredev/email-sdk";
 *
 * declare module "@opencoredev/email-sdk" {
 *   interface EmailMetadataRegister {
 *     metadata: { tenantId: string; traceId?: string };
 *   }
 * }
 * ```
 */
export interface EmailMetadataRegister {}

/** Send-option metadata: the registered shape, or `EmailMetadataRecord` when none is registered. */
export type EmailSendMetadata = EmailMetadataRegister extends {
  metadata: infer Metadata extends object;
}
  ? Metadata
  : EmailMetadataRecord;

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

/** A JSON-compatible value accepted inside provider-native options. */
export type EmailNativeValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly EmailNativeValue[]
  | { readonly [key: string]: EmailNativeValue };

/** The widest shape a provider's native options can take. */
export type EmailNativeObject = { readonly [key: string]: EmailNativeValue };

/**
 * The escape hatch every native-aware HTTP JSON adapter accepts. Use it for provider fields the
 * SDK does not model yet.
 */
export type EmailNativePassthrough = {
  /** Shallow-merged over the request body the adapter builds. Keys here replace the SDK's. */
  body?: EmailNativeObject;
  /**
   * Extra HTTP request headers for the provider API call. These are not email headers. Naming a
   * header the adapter or transport sets, in any letter case, throws an `EmailValidationError`.
   */
  headers?: Readonly<Record<string, string>>;
};

/** Native options keyed by adapter name, as core sees them before routing picks an adapter. */
export type EmailNativeOptionsMap = { readonly [adapter: string]: EmailNativeObject | undefined };

/** The native options type an adapter declares, read from its type-only `~native` marker. */
export type AdapterNativeOptions<Adapter> = Adapter extends {
  readonly "~native"?: infer Native;
}
  ? Native
  : never;

// True only when Native is exactly the EmailAdapter default, meaning the adapter declared nothing.
// Assignability is not enough: an all-optional options type and the default accept each other.
type IsUndeclaredNative<Native> =
  (<T>() => T extends Native ? 1 : 2) extends <T>() => T extends EmailNativeObject ? 1 : 2
    ? true
    : false;

type NativeEntries<Routes extends readonly EmailAdapter[]> = {
  readonly [Adapter in Routes[number] as IsUndeclaredNative<
    AdapterNativeOptions<Adapter>
  > extends true
    ? never
    : Adapter["name"]]?: AdapterNativeOptions<Adapter>;
};

/**
 * Experimental. The `native` send option for a client: one optional entry per adapter that
 * declares native options, keyed by adapter name. Each adapter receives only its own entry, so
 * options for one provider never reach another in a fallback chain. A client whose adapters
 * declare none accepts only an empty object. An untyped client (`EmailClient` with its default
 * routes) accepts any adapter's entry, so every typed client stays assignable to it.
 */
export type EmailNativeOptions<Routes extends readonly EmailAdapter[]> =
  string extends Routes[number]["name"]
    ? EmailNativeOptionsMap
    : keyof NativeEntries<Routes> extends never
      ? { readonly [adapter: string]: never }
      : NativeEntries<Routes>;

export type EmailAdapterContext<Native extends EmailNativeObject = EmailNativeObject> =
  EmailAdapterValidationContext & {
    attempt: number;
    signal?: AbortSignal;
    idempotencyKey?: string;
    metadata?: EmailSendMetadata;
    /** Experimental. This adapter's entry from the send's `native` option. */
    native?: Native;
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

export type EmailAdapter<
  Name extends string = string,
  RawClient = unknown,
  RawResult = unknown,
  Native extends EmailNativeObject = EmailNativeObject,
> = {
  readonly name: Name;
  readonly capabilities: EmailAdapterCapabilities;
  readonly raw?: RawClient;
  /**
   * Type-only marker for the native send options this adapter accepts. Adapters never set it at
   * runtime; `createEmailClient` reads it to type the `native` send option.
   */
  readonly "~native"?: Native;
  validate?(message: EmailMessage, context: EmailAdapterValidationContext): MaybePromise<void>;
  send(
    message: EmailMessage,
    context: EmailAdapterContext<Native>,
  ): MaybePromise<EmailSendResult<Name, RawResult>>;
  sendPersonalized?(
    input: EmailPersonalizedInput,
    context: EmailAdapterContext<Native>,
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

type EmailSendOptionsBase<Name extends string> = {
  adapter?: Name;
  fallback?: EmailFallbackConfig<Name>;
  retry?: EmailRetryConfig;
  signal?: AbortSignal;
  idempotencyKey?: string;
  /**
   * What `idempotencyKey` requires of the route. `"strict"` (the default) rejects the send with
   * an `EmailValidationError` before any request when an adapter on the route reports
   * `capabilities.idempotency: "none"`, because that adapter cannot deduplicate a retried send.
   * `"best-effort"` sends anyway and forwards the key to adapters that use it; choose it when the
   * key is for your own bookkeeping or another layer (a queue, an outbox) already deduplicates.
   */
  idempotency?: "strict" | "best-effort";
  metadata?: EmailSendMetadata;
};

/**
 * `Native` defaults to `never`, which leaves `native` out of the shape entirely. A plain
 * `EmailSendOptions<Name>` is then exactly the pre-native shape: it stays assignable to every
 * client's send options, and code annotated with it still accepts the options core, plugins, and
 * middleware pass around. A client types `native` from its adapters (`EmailNativeOptions`).
 */
export type EmailSendOptions<
  Name extends string = string,
  Native extends EmailNativeOptionsMap = never,
> = [Native] extends [never]
  ? EmailSendOptionsBase<Name>
  : EmailSendOptionsBase<Name> & {
      /**
       * Experimental. Provider-native options keyed by adapter name. Each adapter that is tried
       * receives only its own entry; adapters without an entry send exactly what they send today.
       */
      native?: Native;
    };

/** Options for `sendMany`: send options shared by every item, plus batch-only settings. */
export type EmailSendManyOptions<
  Name extends string = string,
  Native extends EmailNativeOptionsMap = never,
> = EmailSendOptions<Name, Native> & {
  /**
   * How many items send at once. Defaults to `1`, which sends one after another in input order.
   * Results always come back in input order, whatever the concurrency. Must be a positive
   * integer; keep it within your provider's rate limit, since each item is its own request.
   */
  concurrency?: number;
};

export type EmailValidationWarning = {
  code: string;
  message: string;
};

export type EmailValidationResult<Name extends string = string> = {
  adapter: Name;
  warnings: readonly EmailValidationWarning[];
};

/**
 * Send options as core, plugins, and middleware see them: `native` entries for any adapter, not
 * yet matched to the adapter that will receive them.
 */
export type EmailNativeSendOptions = EmailSendOptions<string, EmailNativeOptionsMap>;

/** `sendMany` options as core sees them, with `native` entries for any adapter. */
export type EmailNativeSendManyOptions = EmailSendManyOptions<string, EmailNativeOptionsMap>;

export type EmailSendItem<
  Name extends string = string,
  Native extends EmailNativeOptionsMap = never,
> = {
  message: EmailMessage;
  options?: EmailSendOptions<Name, Native>;
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
  options?: EmailNativeSendOptions;
};

export type EmailBeforeSendResult = {
  message?: EmailMessage;
  options?: EmailNativeSendOptions;
};

export type EmailHookEvent = {
  adapter: string;
  message: EmailMessage;
  attempt: number;
  metadata?: EmailSendMetadata;
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
   * Opt-out usage telemetry with a stable installation identifier. Defaults to enabled. Set `false` here or use
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
    options?: EmailSendOptions<RouteName<Routes>, EmailNativeOptions<Routes>>,
  ): Promise<EmailValidationResult<RouteName<Routes>>>;
  send(
    message: EmailMessage,
    options?: EmailSendOptions<RouteName<Routes>, EmailNativeOptions<Routes>>,
  ): Promise<EmailSendResult<RouteName<Routes>>>;
  sendMany(
    items: readonly EmailSendItem<RouteName<Routes>, EmailNativeOptions<Routes>>[],
    options?: EmailSendManyOptions<RouteName<Routes>, EmailNativeOptions<Routes>>,
  ): Promise<readonly EmailSendSettledResult<RouteName<Routes>>[]>;
  sendPersonalized(
    input: EmailPersonalizedInput,
    options?: EmailSendOptions<RouteName<Routes>, EmailNativeOptions<Routes>>,
  ): Promise<EmailPersonalizedResult<RouteName<Routes>>>;
  adapter<Name extends RouteName<Routes>>(name: Name): AdapterForName<Routes, Name>;
  /**
   * Waits for in-flight opt-out telemetry to finish sending. Sends fire telemetry
   * without awaiting it so delivery never blocks an email, which means serverless
   * runtimes (Vercel, Lambda, Workers) freeze the process on response and drop it.
   * Await this — or hand it to `waitUntil` — at the end of a request to keep counts
   * accurate. Resolves immediately when telemetry is disabled, and never rejects.
   */
  flush(): Promise<void>;
  withAdapter<Name extends RouteName<Routes>>(
    name: Name,
  ): Pick<EmailClient<Routes>, "validate" | "send" | "sendMany" | "sendPersonalized">;
} & Extension;
