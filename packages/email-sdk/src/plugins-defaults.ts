import type {
  EmailAddress,
  EmailHeader,
  EmailMessage,
  EmailPlugin,
  EmailTag,
  EmailSendOptions,
} from "./types.js";

export type EmailDefaultsPluginOptions = {
  id?: string;
  headers?: readonly EmailHeader[];
  tags?: readonly EmailTag[];
  metadata?: EmailMessage["metadata"];
  sendMetadata?: EmailSendOptions["metadata"];
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
  };
}

function withSendOptionDefaults(
  sendOptions: EmailSendOptions | undefined,
  _message: EmailMessage,
  options: EmailDefaultsPluginOptions,
): EmailSendOptions | undefined {
  const metadata = mergeUnknownMetadata(options.sendMetadata, sendOptions?.metadata);
  const idempotencyKey = applyIdempotencyDefault(sendOptions?.idempotencyKey, options);

  if (!sendOptions && !metadata && !idempotencyKey) {
    return undefined;
  }

  return {
    ...sendOptions,
    metadata,
    idempotencyKey,
  };
}

function mergeHeaders(
  defaults: readonly EmailHeader[] | undefined,
  value: readonly EmailHeader[] | undefined,
) {
  if (!defaults) {
    return value;
  }

  if (!value) {
    return defaults;
  }

  return [...defaults, ...value];
}

function mergeTags(
  defaults: readonly EmailTag[] | undefined,
  value: readonly EmailTag[] | undefined,
) {
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
  defaults: EmailSendOptions["metadata"] | undefined,
  value: EmailSendOptions["metadata"] | undefined,
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
