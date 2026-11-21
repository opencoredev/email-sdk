import { EmailValidationError } from "./errors.js";
import type {
  EmailAddress,
  EmailHeader,
  EmailMessage,
  EmailPlugin,
  EmailTag,
  EmailSendOptions,
} from "./types.js";
import { cloneMetadataRecord, isNonArrayObject, isStringMember } from "./internal/decode.js";
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
  if (options.metadata !== undefined && !isNonArrayObject(options.metadata)) {
    throw new EmailValidationError("defaultsPlugin metadata must be an object.");
  }

  if (options.sendMetadata !== undefined && !isNonArrayObject(options.sendMetadata)) {
    throw new EmailValidationError("defaultsPlugin sendMetadata must be an object.");
  }

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

function cloneReplyTo(
  replyTo: EmailDefaultsPluginOptions["replyTo"],
): EmailDefaultsPluginOptions["replyTo"] {
  if (replyTo === undefined || isStringMember(replyTo)) return replyTo;

  if (Array.isArray(replyTo)) {
    return replyTo.map((entry) => (isStringMember(entry) ? entry : { ...entry }));
  }

  return { ...replyTo };
}

function withMessageDefaults(
  message: EmailMessage,
  options: EmailDefaultsPluginOptions,
): EmailMessage {
  // SAFETY: Copying known EmailMessage fields preserves class-instance prototype getters while keeping the html-or-text shape.
  return {
    ...message,
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    html: message.html,
    text: message.text,
    attachments: message.attachments,
    sendAt: message.sendAt,
    replyTo: message.replyTo ?? cloneReplyTo(options.replyTo),
    headers: mergeHeaders(options.headers, message.headers),
    tags: mergeTags(options.tags, message.tags),
    metadata: mergeMetadata(options.metadata, message.metadata),
  } as EmailMessage;
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
    return defaults.map((header) => ({ ...header }));
  }

  const overridden = new Set(own.map((header) => header.name.toLowerCase()));

  return [
    ...defaults
      .filter((header) => !overridden.has(header.name.toLowerCase()))
      .map((header) => ({ ...header })),
    ...own.map((header) => ({ ...header })),
  ];
}

function mergeTags(
  defaults: readonly EmailTag[] | undefined,
  value: readonly EmailTag[] | undefined,
) {
  if (!defaults?.length) {
    return value;
  }

  if (!value?.length) {
    return defaults.map((tag) => ({ ...tag }));
  }

  return [...defaults.map((tag) => ({ ...tag })), ...value.map((tag) => ({ ...tag }))];
}

function mergeMetadata(
  defaults: EmailMessage["metadata"] | undefined,
  value: EmailMessage["metadata"] | undefined,
) {
  if (defaults === undefined) {
    return value;
  }

  if (!isNonArrayObject(defaults)) {
    return value ?? defaults;
  }

  if (value !== undefined && !isNonArrayObject(value)) {
    return value;
  }

  return cloneMetadataRecord({
    ...defaults,
    ...value,
  });
}

function mergeSendMetadata(
  defaults: EmailSendOptions["metadata"] | undefined,
  value: EmailSendOptions["metadata"] | undefined,
) {
  if (defaults === undefined) {
    return value;
  }

  if (!isNonArrayObject(defaults)) {
    return value ?? defaults;
  }

  if (value !== undefined && !isNonArrayObject(value)) {
    return value;
  }

  return cloneMetadataRecord({
    ...defaults,
    ...value,
  });
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
