import type {
  EmailAddress,
  EmailHeader,
  EmailMessage,
  EmailPlugin,
  EmailTag,
  SendOptions,
} from "./types.js";

export type EmailDefaultsPluginOptions = {
  id?: string;
  headers?: Record<string, string> | EmailHeader[];
  tags?: EmailTag[];
  metadata?: EmailMessage["metadata"];
  sendMetadata?: SendOptions["metadata"];
  replyTo?: EmailAddress | EmailAddress[];
  idempotencyKey?: string;
  idempotencyKeyPrefix?: string;
};

export function defaultsPlugin(options: EmailDefaultsPluginOptions): EmailPlugin {
  return {
    id: options.id ?? "defaults",
    middleware: [
      {
        beforeSend(event) {
          const message = withMessageDefaults(event.message, options);
          const sendOptions = withSendOptionDefaults(event.options, message, options);

          return {
            message,
            options: sendOptions,
          };
        },
      },
    ],
  };
}

function withMessageDefaults(
  message: EmailMessage,
  options: EmailDefaultsPluginOptions,
): EmailMessage {
  return {
    ...message,
    replyTo: message.replyTo ?? options.replyTo,
    headers: mergeHeaders(options.headers, message.headers),
    tags: mergeTags(options.tags, message.tags),
    metadata: mergeMetadata(options.metadata, message.metadata),
    idempotencyKey: applyIdempotencyDefault(message.idempotencyKey, options),
  };
}

function withSendOptionDefaults(
  sendOptions: SendOptions | undefined,
  message: EmailMessage,
  options: EmailDefaultsPluginOptions,
): SendOptions | undefined {
  const metadata = mergeUnknownMetadata(options.sendMetadata, sendOptions?.metadata);
  const idempotencyKey = applyIdempotencyDefault(sendOptions?.idempotencyKey, options);

  if (!sendOptions && !metadata && idempotencyKey === message.idempotencyKey) {
    return undefined;
  }

  return {
    ...sendOptions,
    metadata,
    idempotencyKey,
  };
}

function mergeHeaders(
  defaults: Record<string, string> | EmailHeader[] | undefined,
  value: Record<string, string> | EmailHeader[] | undefined,
) {
  if (!defaults) {
    return value;
  }

  if (!value) {
    return defaults;
  }

  return {
    ...headersToRecord(defaults),
    ...headersToRecord(value),
  };
}

function headersToRecord(headers: Record<string, string> | EmailHeader[]) {
  if (!Array.isArray(headers)) {
    return headers;
  }

  return Object.fromEntries(headers.map((header) => [header.name, header.value]));
}

function mergeTags(defaults: EmailTag[] | undefined, value: EmailTag[] | undefined) {
  if (!defaults?.length) {
    return value;
  }

  if (!value?.length) {
    return defaults;
  }

  return [...defaults, ...value];
}

function mergeMetadata(
  defaults: EmailMessage["metadata"] | undefined,
  value: EmailMessage["metadata"] | undefined,
) {
  if (!defaults) {
    return value;
  }

  return {
    ...defaults,
    ...value,
  };
}

function mergeUnknownMetadata(
  defaults: SendOptions["metadata"] | undefined,
  value: SendOptions["metadata"] | undefined,
) {
  if (!defaults) {
    return value;
  }

  return {
    ...defaults,
    ...value,
  };
}

function applyIdempotencyDefault(
  value: string | undefined,
  options: Pick<EmailDefaultsPluginOptions, "idempotencyKey" | "idempotencyKeyPrefix">,
) {
  const key = value ?? options.idempotencyKey;

  if (!key || !options.idempotencyKeyPrefix || key.startsWith(options.idempotencyKeyPrefix)) {
    return key;
  }

  return `${options.idempotencyKeyPrefix}${key}`;
}
