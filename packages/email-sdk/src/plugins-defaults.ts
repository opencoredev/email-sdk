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
  if (!isNonArrayObject(options)) {
    throw new EmailValidationError("defaultsPlugin options must be an object.");
  }

  let safeOptions: EmailDefaultsPluginOptions;

  try {
    const id = options.id;
    const metadata = options.metadata;
    const sendMetadata = options.sendMetadata;
    const headers = options.headers;
    const tags = options.tags;
    const replyTo = options.replyTo;
    const idempotencyKey = options.idempotencyKey;
    const idempotencyKeyPrefix = options.idempotencyKeyPrefix;

    if (metadata !== undefined && !isNonArrayObject(metadata)) {
      throw new EmailValidationError("defaultsPlugin metadata must be an object.");
    }

    if (sendMetadata !== undefined && !isNonArrayObject(sendMetadata)) {
      throw new EmailValidationError("defaultsPlugin sendMetadata must be an object.");
    }

    let safeHeaders: EmailHeader[] | undefined;

    if (headers !== undefined) {
      if (!Array.isArray(headers)) {
        throw new EmailValidationError("defaultsPlugin headers must be an array.");
      }

      safeHeaders = [...headers].map((header) => {
        if (
          !isNonArrayObject(header) ||
          !isStringMember(header.name) ||
          header.name.length === 0 ||
          !isStringMember(header.value)
        ) {
          throw new EmailValidationError(
            "defaultsPlugin headers must contain objects with non-empty string name and string value.",
          );
        }

        return { name: header.name, value: header.value };
      });
    }

    let safeTags: EmailTag[] | undefined;

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        throw new EmailValidationError("defaultsPlugin tags must be an array.");
      }

      safeTags = [...tags].map((tag) => {
        if (
          !isNonArrayObject(tag) ||
          !isStringMember(tag.name) ||
          !isStringMember(tag.value)
        ) {
          throw new EmailValidationError(
            "defaultsPlugin tags must contain objects with string name and string value.",
          );
        }

        return { name: tag.name, value: tag.value };
      });
    }

    safeOptions = {
      id,
      headers: safeHeaders,
      tags: safeTags,
      metadata: metadata === undefined ? undefined : cloneMetadataRecord(metadata),
      sendMetadata: sendMetadata === undefined ? undefined : cloneMetadataRecord(sendMetadata),
      replyTo: cloneReplyTo(replyTo),
      idempotencyKey,
      idempotencyKeyPrefix,
    };
  } catch (error) {
    if (error instanceof EmailValidationError) throw error;
    throw new EmailValidationError("defaultsPlugin options could not be read.");
  }

  return {
    id: safeOptions.id ?? "defaults",
    middleware: [
      {
        beforeSend(event) {
          const message = withMessageDefaults(event.message, safeOptions);
          const sendOptions = withSendOptionDefaults(event.options, message, safeOptions);

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
    return replyTo.map((entry) =>
      isStringMember(entry) || !isNonArrayObject(entry)
        ? entry
        : { ...entry, email: entry.email, name: entry.name },
    );
  }

  if (!isNonArrayObject(replyTo)) return replyTo;

  return { ...replyTo, email: replyTo.email, name: replyTo.name };
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

  if (!sendOptions && metadata === undefined && idempotencyKey === undefined) {
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

  if (value === undefined) {
    return defaults.map((header) => ({ ...header, name: header.name, value: header.value }));
  }

  if (Array.isArray(value)) {
    if (
      value.some(
        (header) => !isNonArrayObject(header) || !isStringMember(header.name) || header.name.length === 0,
      )
    ) {
      return value;
    }
  } else if (!isNonArrayObject(value)) {
    return value;
  }

  // headerList also reads the legacy name-to-value object that JavaScript callers send.
  const own = headerList(value);

  if (own.length === 0) {
    return defaults.map((header) => ({ ...header, name: header.name, value: header.value }));
  }

  const overridden = new Set(own.map((header) => header.name.toLowerCase()));

  return [
    ...defaults
      .filter((header) => !overridden.has(header.name.toLowerCase()))
      .map((header) => ({ ...header, name: header.name, value: header.value })),
    ...own.map((header) => ({ ...header, name: header.name, value: header.value })),
  ];
}

function mergeTags(
  defaults: readonly EmailTag[] | undefined,
  value: readonly EmailTag[] | undefined,
) {
  if (!defaults?.length) {
    return value;
  }

  if (value === undefined) {
    return defaults.map((tag) => ({ ...tag, name: tag.name, value: tag.value }));
  }

  if (!Array.isArray(value) || value.some((tag) => !isNonArrayObject(tag))) {
    return value;
  }

  if (!value.length) {
    return defaults.map((tag) => ({ ...tag, name: tag.name, value: tag.value }));
  }

  return [
    ...defaults.map((tag) => ({ ...tag, name: tag.name, value: tag.value })),
    ...value.map((tag) => ({ ...tag, name: tag.name, value: tag.value })),
  ];
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

  const clonedDefaults = cloneMetadataRecord(defaults);
  const clonedValue = value === undefined ? undefined : cloneMetadataRecord(value);

  return {
    ...clonedDefaults,
    ...clonedValue,
  };
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

  const clonedDefaults = cloneMetadataRecord(defaults);
  const clonedValue = value === undefined ? undefined : cloneMetadataRecord(value);

  return {
    ...clonedDefaults,
    ...clonedValue,
  };
}

function applyIdempotencyDefault(
  value: string | undefined,
  options: Pick<EmailDefaultsPluginOptions, "idempotencyKey" | "idempotencyKeyPrefix">,
) {
  const key = value ?? options.idempotencyKey;

  if (
    !isStringMember(key) ||
    key.trim().length === 0 ||
    !isStringMember(options.idempotencyKeyPrefix) ||
    !options.idempotencyKeyPrefix ||
    key.startsWith(options.idempotencyKeyPrefix)
  ) {
    return key;
  }

  return `${options.idempotencyKeyPrefix}${key}`;
}
