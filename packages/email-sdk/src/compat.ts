import { createEmailClient as createV1EmailClient } from "./core.js";
import type {
  EmailAdapter as V1EmailAdapter,
  EmailAddress as V1EmailAddress,
  EmailAdapterContext,
  EmailMessage as V1EmailMessage,
  EmailPersonalizedInput,
  EmailPlugin as V1EmailPlugin,
  EmailPluginContext as V1EmailPluginContext,
  EmailSendMiddleware as V1EmailSendMiddleware,
  EmailSendOptions as V1EmailSendOptions,
  EmailSendResult as V1EmailSendResult,
  MaybePromise,
  RecipientVariables as V1RecipientVariables,
  UnionToIntersection,
} from "./types.js";
import { normalizeAdapterResult } from "./utils.js";

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
  metadata?: Record<string, unknown>;
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
  delay?: (attempt: number, error: unknown) => number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
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

  const legacy = {
    ...client,
    adapters: legacyAdapters,
    providers: legacyAdapters,
    defaultProvider: client.defaultAdapter,
    adapter<TProvider extends EmailProvider = EmailProvider>(name: string) {
      client.adapter(name);
      return legacyAdapters.get(name) as unknown as TProvider;
    },
    provider<TProvider extends EmailProvider = EmailProvider>(name: string) {
      warnOnce("provider", "Use adapter(name) instead.");
      client.adapter(name);
      return legacyAdapters.get(name) as unknown as TProvider;
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
  } as unknown as EmailClient<EmailPluginClientExtensions<TPlugins>>;

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

  return legacy;
}

function toV1Adapter(adapter: LegacyEmailAdapter): V1EmailAdapter {
  if ("capabilities" in adapter) return adapter;
  warnOnce("legacy-adapter", `Adapter "${adapter.name}" should declare v1 capabilities.`);

  const v1Adapter: V1EmailAdapter = {
    name: adapter.name,
    capabilities: {
      repeatedHeaders: true,
      idempotency: "native",
      scheduling: true,
      personalized: adapter.sendBulk ? "native" : "expanded",
    },
    raw: adapter.raw,
    async send(message, context) {
      return normalizeAdapterResult(
        adapter.name,
        await adapter.send(toLegacyMessage(message), toLegacyProviderContext(context)),
      );
    },
  };

  if (adapter.sendBulk) {
    v1Adapter.sendPersonalized = async (input, context) => {
      const result = normalizeAdapterResult(
        adapter.name,
        await adapter.sendBulk!(toLegacyBulkMessage(input), toLegacyProviderContext(context)),
      );
      return {
        ...result,
        accepted: result.accepted ?? input.recipients.map((recipient) => mailbox(recipient.to)),
        rejected: result.rejected ?? [],
      };
    };
  }

  return v1Adapter;
}

function toV1Plugin(plugin: EmailPlugin): V1EmailPlugin {
  const pluginAdapters = plugin.adapters;
  const adapters = Array.isArray(pluginAdapters)
    ? pluginAdapters.map(toV1Adapter)
    : typeof pluginAdapters === "function"
      ? (context: V1EmailPluginContext) =>
          pluginAdapters(toLegacyPluginContext(context)).map(toV1Adapter)
      : undefined;

  return {
    id: plugin.id,
    adapters,
    hooks: plugin.hooks ? toV1Hooks(plugin.hooks) : undefined,
    middleware: plugin.middleware?.map(toV1Middleware),
    extendClient: plugin.extendClient
      ? (context) => plugin.extendClient!(toLegacyPluginContext(context))
      : undefined,
  };
}

function toV1Hooks(hooks: EmailHooks): NonNullable<Parameters<typeof createV1EmailClient>[0]["hooks"]> {
  return {
    beforeSend: hooks.beforeSend
      ? (event) => hooks.beforeSend!(toLegacyHookEvent(event))
      : undefined,
    afterSend: hooks.afterSend
      ? (event) =>
          hooks.afterSend!({
            ...toLegacyHookEvent(event),
            response: withLegacyResult(event.response),
          })
      : undefined,
    onError: hooks.onError
      ? (event) => hooks.onError!({ ...toLegacyHookEvent(event), error: event.error })
      : undefined,
    onRetry: hooks.onRetry
      ? (event) =>
          hooks.onRetry!({
            ...toLegacyHookEvent(event),
            error: event.error,
            nextAttempt: event.nextAttempt,
            delayMs: event.delayMs,
          })
      : undefined,
  };
}

function toV1Middleware(middleware: EmailSendMiddleware): V1EmailSendMiddleware {
  return {
    beforeSend: middleware.beforeSend
      ? async (event) => {
          const message = toLegacyMessage(event.message);
          const result = await middleware.beforeSend!({
            message,
            options: toLegacyOptions(event.options),
          });
          if (!result) return undefined;
          return {
            message: result.message ? toV1Message(result.message) : undefined,
            options: result.options
              ? toV1Options(result.message ?? message, result.options)
              : undefined,
          };
        }
      : undefined,
    afterSend: middleware.afterSend
      ? (event) =>
          middleware.afterSend!({
            ...toLegacyHookEvent(event),
            response: withLegacyResult(event.response),
          })
      : undefined,
    onError: middleware.onError
      ? (event) => middleware.onError!({ ...toLegacyHookEvent(event), error: event.error })
      : undefined,
  };
}

function toLegacyPluginContext(context: V1EmailPluginContext): EmailPluginContext {
  return {
    adapters: new Map(
      [...context.adapters].map(([name, adapter]) => [name, toLegacyProvider(adapter)]),
    ),
    defaultAdapter: context.defaultAdapter,
    addAdapter(adapter) {
      context.addAdapter(toV1Adapter(adapter));
    },
  };
}

function toLegacyHookEvent(event: {
  adapter: string;
  message: V1EmailMessage;
  attempt: number;
  metadata?: Readonly<Record<string, unknown>>;
}): EmailHookEvent {
  return {
    provider: event.adapter,
    message: toLegacyMessage(event.message),
    attempt: event.attempt,
    metadata: event.metadata ? { ...event.metadata } : undefined,
  };
}

function toLegacyProviderContext(context: EmailAdapterContext): EmailProviderContext {
  return {
    signal: context.signal,
    idempotencyKey: context.idempotencyKey,
    attempt: context.attempt,
    metadata: context.metadata ? { ...context.metadata } : undefined,
  };
}

function toLegacyProvider(adapter: V1EmailAdapter): EmailProvider {
  return {
    name: adapter.name,
    raw: adapter.raw,
    async send(message, context) {
      return withLegacyResult(
        normalizeAdapterResult(
          adapter.name,
          await adapter.send(toV1Message(message), {
            adapter: adapter.name,
            operation: "send",
            ...context,
          }),
        ),
      );
    },
    ...(adapter.sendPersonalized
      ? {
          async sendBulk(message: EmailMessage, context: EmailProviderContext) {
            const result = await adapter.sendPersonalized!(toPersonalizedInput(message), {
              adapter: adapter.name,
              operation: "personalized",
              ...context,
            });
            return withLegacyResult(normalizeAdapterResult(adapter.name, result));
          },
        }
      : {}),
  };
}

function toV1Message(message: EmailMessage): V1EmailMessage {
  const headers = Array.isArray(message.headers)
    ? message.headers
    : Object.entries(message.headers ?? {}).map(([name, value]) => ({ name, value }));
  return {
    from: message.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    cc: message.cc,
    bcc: message.bcc,
    replyTo: message.replyTo,
    headers,
    attachments: message.attachments,
    tags: message.tags,
    metadata: message.metadata,
    sendAt: message.sendAt as V1EmailMessage["sendAt"],
  } as V1EmailMessage;
}

function toLegacyMessage(message: V1EmailMessage): EmailMessage {
  return {
    from: message.from,
    to: mutableAddresses(message.to)!,
    subject: message.subject,
    html: message.html,
    text: message.text,
    cc: mutableAddresses(message.cc),
    bcc: mutableAddresses(message.bcc),
    replyTo: mutableAddresses(message.replyTo),
    headers: message.headers ? [...message.headers] : undefined,
    attachments: message.attachments ? ([...message.attachments] as EmailAttachment[]) : undefined,
    tags: message.tags ? [...message.tags] : undefined,
    metadata: message.metadata,
    sendAt: message.sendAt,
  };
}

function mutableAddresses(
  value: V1EmailAddress | readonly V1EmailAddress[] | undefined,
): EmailAddress | EmailAddress[] | undefined {
  return Array.isArray(value) ? [...value] : (value as EmailAddress | undefined);
}

function toV1Options(
  message: EmailMessage,
  options: SendOptions | undefined,
): V1EmailSendOptions | undefined {
  if (!options && !message.idempotencyKey) return undefined;
  if (message.idempotencyKey) {
    warnOnce("message-idempotency", "Move idempotencyKey to the send options argument.");
  }
  if (options?.provider) warnOnce("send-provider", "Use send option adapter instead of provider.");
  if (options?.retries !== undefined) warnOnce("send-retries", "Use retry.maxAttempts instead.");
  const fallbacks = options?.fallbackAdapters ?? options?.fallbackProviders;
  return {
    adapter: options?.adapter ?? options?.provider,
    fallback: fallbacks ? { adapters: fallbacks, onUnknownDelivery: "stop" } : undefined,
    retry: options?.retries === undefined ? undefined : { maxAttempts: options.retries + 1 },
    signal: options?.signal,
    idempotencyKey: options?.idempotencyKey ?? message.idempotencyKey,
    metadata: options?.metadata,
  };
}

function toLegacyOptions(options: V1EmailSendOptions | undefined): SendOptions | undefined {
  if (!options) return undefined;
  return {
    adapter: options.adapter,
    fallbackAdapters: options.fallback?.adapters ? [...options.fallback.adapters] : undefined,
    retries:
      options.retry?.maxAttempts === undefined ? undefined : Math.max(0, options.retry.maxAttempts - 1),
    signal: options.signal,
    idempotencyKey: options.idempotencyKey,
    metadata: options.metadata ? { ...options.metadata } : undefined,
  };
}

function toPersonalizedInput(message: EmailMessage): EmailPersonalizedInput {
  const { recipientVariables = {}, to, cc: _cc, bcc: _bcc, ...base } = message;
  const recipients = (Array.isArray(to) ? to : [to]).map((address) => ({
    to: address,
    variables: recipientVariables[mailbox(address)] ?? {},
  }));
  return {
    message: toV1Message({ ...base, to } as EmailMessage) as EmailPersonalizedInput["message"],
    recipients,
  };
}

function toLegacyBulkMessage(input: EmailPersonalizedInput): EmailMessage {
  const to = input.recipients.map((recipient) => recipient.to);
  return {
    ...toLegacyMessage({ ...input.message, to } as V1EmailMessage),
    recipientVariables: Object.fromEntries(
      input.recipients.map((recipient) => [mailbox(recipient.to), recipient.variables]),
    ),
  };
}

function mailbox(address: EmailAddress): string {
  return typeof address === "string"
    ? (address.match(/<([^>]+)>/)?.[1] ?? address).trim()
    : address.email;
}

function withLegacyResult(result: V1EmailSendResult): LegacyEmailResult {
  const legacy = { ...result } as LegacyEmailResult;
  Object.defineProperties(legacy, {
    provider: { enumerable: false, get: () => result.adapter },
    messageId: { enumerable: false, get: () => result.id },
  });
  return legacy;
}

const warned = new Set<string>();

function warnOnce(feature: string, message: string) {
  if (
    warned.has(feature) ||
    process.env.NODE_ENV === "production" ||
    process.env.NODE_ENV === "test"
  ) {
    return;
  }
  warned.add(feature);
  console.warn(`[email-sdk/compat] ${message}`);
}
