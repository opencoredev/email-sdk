import { createEmailClient as createV1EmailClient } from "./core.js";
import {
  toLegacyProvider,
  toV1Adapter,
  toV1Hooks,
  toV1Plugin,
} from "./compat/adapters.js";
import {
  toPersonalizedInput,
  toV1Message,
  toV1Options,
  withLegacyResult,
} from "./compat/messages.js";
import { warnOnce } from "./compat/warn.js";
import type { EmailSdkError } from "./errors.js";
import type {
  EmailAdapter as V1EmailAdapter,
  EmailAddress as V1EmailAddress,
  EmailSendMetadata,
  EmailSendResult as V1EmailSendResult,
  MaybePromise,
  RecipientVariables as V1RecipientVariables,
  UnionToIntersection,
} from "./types.js";

export {
  EmailProviderError,
  EmailProviderNotFoundError,
  EmailSdkError,
  EmailValidationError,
  isRetryableEmailError,
} from "./errors.js";

export type EmailAddress = V1EmailAddress;

export type OneOrMany<T> = T | T[];

export type RecipientVariables = V1RecipientVariables;

export type { MaybePromise, UnionToIntersection };

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
  recipientVariables?: RecipientVariables;
  sendAt?: Date | string;
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
  metadata?: EmailSendMetadata;
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
  metadata?: EmailSendMetadata;
};

export type EmailProvider<TRaw = unknown> = {
  name: string;
  send(message: EmailMessage, context: EmailProviderContext): MaybePromise<EmailProviderResponse>;
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

export type EmailHookEvent = {
  provider: string;
  message: EmailMessage;
  attempt: number;
  metadata?: EmailSendMetadata;
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

export type EmailHooks = {
  beforeSend?: (event: EmailHookEvent) => MaybePromise<void>;
  afterSend?: (event: EmailAfterSendEvent) => MaybePromise<void>;
  onError?: (event: EmailErrorEvent) => MaybePromise<void>;
  onRetry?: (
    event: EmailHookEvent & { error: unknown; nextAttempt: number; delayMs: number },
  ) => MaybePromise<void>;
};

export type EmailPlugin<TExtension extends object = object> = {
  id: string;
  adapters?: EmailProvider[] | ((context: EmailPluginContext) => EmailProvider[]);
  hooks?: EmailHooks;
  middleware?: EmailSendMiddleware[];
  extendClient?: (context: EmailPluginContext) => TExtension;
};

export type EmailPluginClientExtension<TPlugin> =
  TPlugin extends EmailPlugin<infer TExtension> ? TExtension : object;

export type EmailPluginClientExtensions<TPlugins extends readonly EmailPlugin[]> =
  UnionToIntersection<EmailPluginClientExtension<TPlugins[number]>> extends infer TExtension
    ? TExtension extends object
      ? TExtension
      : object
    : object;

export type EmailRetryConfig = {
  retries?: number;
  delay?: (attempt: number, error: EmailSdkError) => number;
  shouldRetry?: (error: EmailSdkError, attempt: number) => boolean;
};

export type EmailClientOptions<
  TPlugins extends readonly EmailPlugin[] = readonly EmailPlugin[],
> = {
  adapters?: readonly LegacyEmailAdapter[];
  providers?: readonly LegacyEmailAdapter[];
  defaultAdapter?: string;
  defaultProvider?: string;
  fallback?: readonly string[];
  retry?: EmailRetryConfig;
  hooks?: EmailHooks;
  plugins?: TPlugins;
  telemetry?: boolean;
};

export type SendBatchItem = EmailMessage & {
  adapter?: string;
  provider?: string;
  fallbackAdapters?: string[];
  fallbackProviders?: string[];
};

export type SendBatchResult =
  | { ok: true; index: number; response: EmailProviderResponse }
  | { ok: false; index: number; error: unknown };

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

export type LegacyEmailMessage = EmailMessage;

export type LegacySendOptions = SendOptions;

export type LegacyEmailResult = V1EmailSendResult & EmailProviderResponse;

export type LegacyEmailClientOptions<
  TPlugins extends readonly EmailPlugin[] = readonly EmailPlugin[],
> = EmailClientOptions<TPlugins>;

export type LegacyEmailAdapter = EmailProvider | V1EmailAdapter;

export type LegacySendBatchItem = SendBatchItem;

export type LegacySendBatchResult = SendBatchResult;

export function createEmailClient<
  const TPlugins extends readonly EmailPlugin[] = readonly EmailPlugin[],
>(options: EmailClientOptions<TPlugins>): EmailClient<EmailPluginClientExtensions<TPlugins>> {
  const sourceAdapters = options.adapters ?? options.providers ?? [];

  if (options.providers) warnOnce("providers", "Use adapters instead of providers.");

  if (options.defaultProvider) warnOnce("defaultProvider", "Use defaultAdapter instead.");

  const adapters = sourceAdapters.map(toV1Adapter);

  const fallback = options.fallback
    ? { adapters: options.fallback, onUnknownDelivery: "stop" as const }
    : undefined;

  const retry = options.retry
    ? {
        maxAttempts: (options.retry.retries ?? 0) + 1,
        delay: options.retry.delay,
        shouldRetry: options.retry.shouldRetry,
      }
    : undefined;

  const plugins = options.plugins?.map(toV1Plugin);

  const client = createV1EmailClient({
    adapters,
    defaultAdapter: options.defaultAdapter ?? options.defaultProvider,
    fallback,
    retry,
    hooks: options.hooks ? toV1Hooks(options.hooks) : undefined,
    plugins,
    telemetry: options.telemetry,
  });

  const legacyAdapters = new Map(
    [...client.adapters].map(([name, adapter]) => [name, toLegacyProvider(adapter)]),
  );

  const legacy: EmailClient = {
    ...client,
    adapters: legacyAdapters,
    providers: legacyAdapters,
    defaultProvider: client.defaultAdapter,
    adapter<TProvider extends EmailProvider = EmailProvider>(name: string) {
      client.adapter(name);

      // SAFETY: client.adapter(name) throws for unknown names, so the entry exists; TProvider is
      // the caller's own claim about that adapter, as in the v1 adapter(name) lookup.
      return legacyAdapters.get(name) as TProvider;
    },
    provider<TProvider extends EmailProvider = EmailProvider>(name: string) {
      warnOnce("provider", "Use adapter(name) instead.");
      client.adapter(name);

      // SAFETY: client.adapter(name) throws for unknown names, so the entry exists; TProvider is
      // the caller's own claim about that adapter, as in the v1 adapter(name) lookup.
      return legacyAdapters.get(name) as TProvider;
    },
    withProvider(name: string) {
      warnOnce("withProvider", "Use withAdapter(name) instead.");

      return boundClient(name);
    },
    withAdapter(name: string) {
      return boundClient(name);
    },
    async send(message: EmailMessage, sendOptions?: SendOptions) {
      const send = toV1Options(message, sendOptions);

      if (message.recipientVariables && Object.keys(message.recipientVariables).length > 0) {
        warnOnce("recipientVariables", "Use sendPersonalized({ message, recipients }) instead.");

        return withLegacyResult(
          await client.sendPersonalized(toPersonalizedInput(message), send),
        );
      }

      return withLegacyResult(await client.send(toV1Message(message), send));
    },
    async sendBatch(
      items: readonly SendBatchItem[],
      sendOptions?: SendOptions,
    ): Promise<SendBatchResult[]> {
      warnOnce("sendBatch", "Use sendMany([{ message, options }]) instead.");
      const results: SendBatchResult[] = [];

      for (const [index, item] of items.entries()) {
        const { adapter, provider, fallbackAdapters, fallbackProviders, ...message } = item;

        try {
          const response = await legacy.send(message, {
            ...sendOptions,
            adapter: adapter ?? provider ?? sendOptions?.adapter ?? sendOptions?.provider,
            provider: undefined,
            fallbackAdapters:
              fallbackAdapters ??
              fallbackProviders ??
              sendOptions?.fallbackAdapters ??
              sendOptions?.fallbackProviders,
            fallbackProviders: undefined,
          });

          results.push({ ok: true, index, response });
        } catch (error) {
          results.push({ ok: false, index, error });
        }
      }

      return results;
    },
  };

  function boundClient(name: string) {
    client.adapter(name);

    return {
      send(message: EmailMessage, sendOptions?: SendOptions) {
        return legacy.send(message, { ...sendOptions, adapter: name });
      },
      sendBatch(items: SendBatchItem[], sendOptions?: SendOptions) {
        return legacy.sendBatch(items, { ...sendOptions, adapter: name });
      },
    };
  }

  // SAFETY: `...client` copied the members that createV1EmailClient added through each
  // plugin's extendClient, and toV1Plugin passes every plugin's extendClient through unchanged.
  return legacy as EmailClient<EmailPluginClientExtensions<TPlugins>>;
}
