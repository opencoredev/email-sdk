import type {
  EmailAddress,
  EmailHeader,
  EmailMessage,
  EmailPlugin,
  EmailTag,
  EmailSendOptions,
} from "./types.js";
import { headerList } from "./utils.js";

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
  const metadata = mergeSendMetadata(options.sendMetadata, sendOptions?.metadata);
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

/**
 * A default header applies only when the message does not set a header with the same name
 * (compared case-insensitively, as header names are). Appending both would send two values,
 * which adapters without repeated-header support reject, and on the others the message would
 * not win. Repeated headers within the message itself are kept as given.
 */
function mergeHeaders(
  defaults: readonly EmailHeader[] | undefined,
  value: EmailMessage["headers"],
) {
  if (!defaults?.length) {
    return value;
  }

  // headerList also reads the legacy name-to-value object that JavaScript callers send.
  const own = headerList(value);

  if (own.length === 0) {
    return defaults;
  }

  const overridden = new Set(own.map((header) => header.name.toLowerCase()));

  return [...defaults.filter((header) => !overridden.has(header.name.toLowerCase())), ...own];
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

function mergeSendMetadata(
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
