import { EmailValidationError } from "../errors.js";
import type {
  EmailAddress,
  EmailAttachment,
  EmailMessage,
  EmailNativeObject,
  EmailNativeOptionsMap,
  EmailNativeValue,
  EmailPersonalizedInput,
  OneOrMany,
} from "../types.js";
import {
  cloneMetadataRecord,
  isBinaryBuffer,
  isDateLike,
  isFunction,
  isNonArrayObject,
  isObjectLike,
  isStringMember,
} from "./decode.js";

export const MESSAGE_FIELDS = [
  "from",
  "to",
  "cc",
  "bcc",
  "replyTo",
  "subject",
  "html",
  "text",
  "headers",
  "attachments",
  "tags",
  "metadata",
  "sendAt",
] as const;

export const MAX_BOUNDED_ARRAY_LENGTH = 1_000_000;

/** Copy an array with an explicit length cap so forged huge-length array Proxies fail fast instead of exhausting memory. */
export function copyBoundedArray<T>(
  value: readonly T[],
  label: string,
  max = MAX_BOUNDED_ARRAY_LENGTH,
): T[] {
  const length = value.length;

  if (!Number.isSafeInteger(length) || length < 0 || length > max) {
    throw new EmailValidationError(`${label} exceeds maximum supported length.`);
  }

  const out: T[] = [];

  for (let index = 0; index < length; index += 1) {
    // SAFETY: Index is strictly less than the verified array length.
    out.push(value[index] as T);
  }

  return out;
}

export function snapshotAddressItem(address: EmailAddress): EmailAddress {
  if (isStringMember(address) || !isNonArrayObject(address)) return address;

  const email = address.email;
  const name = address.name;

  return name === undefined ? { email } : { email, name };
}

function isAddressList(value: OneOrMany<EmailAddress>): value is readonly EmailAddress[] {
  return Array.isArray(value);
}

export function snapshotAddressField(value: OneOrMany<EmailAddress>): OneOrMany<EmailAddress> {
  if (isAddressList(value)) {
    return copyBoundedArray(value, "Email address list").map(snapshotAddressItem);
  }

  return snapshotAddressItem(value);
}

interface BinaryViewCtor {
  from?(bytes: Uint8Array): Uint8Array;
}

function cloneAttachmentView(rawVal: ArrayBufferView): Uint8Array {
  const bytes = new Uint8Array(rawVal.buffer, rawVal.byteOffset, rawVal.byteLength).slice();

  if (rawVal instanceof Uint8Array && Object.getPrototypeOf(rawVal) !== Uint8Array.prototype) {
    try {
      // SAFETY: Preserve Uint8Array subclasses via their own static `from` without referencing Node globals.
      const ctor = rawVal.constructor as BinaryViewCtor | undefined;

      if (ctor && isFunction(ctor.from)) {
        const cloned = ctor.from(bytes);

        if (cloned instanceof Uint8Array) return cloned;
      }
    } catch {
      return bytes;
    }
  }

  return bytes;
}

function snapshotAttachmentItem(attachment: EmailAttachment): EmailAttachment {
  if (!isNonArrayObject(attachment)) return attachment;

  const copy: Partial<EmailAttachment> = {};

  for (const key of [
    "filename",
    "content",
    "path",
    "contentType",
    "contentId",
    "disposition",
    "contentEncoding",
  ] as const) {
    const rawVal = attachment[key];

    if (rawVal === undefined) continue;

    const val =
      key === "content" && ArrayBuffer.isView(rawVal)
        ? cloneAttachmentView(rawVal)
        : key === "content" && isBinaryBuffer(rawVal)
          ? new Uint8Array(rawVal).slice().buffer
          : rawVal;

    Object.defineProperty(copy, key, {
      value: val,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  // SAFETY: Every defined EmailAttachment property was copied from `attachment`.
  return copy as EmailAttachment;
}

function snapshotHeaders(value: EmailMessage["headers"]): EmailMessage["headers"] {
  if (Array.isArray(value)) {
    return copyBoundedArray(value, "Email headers").map((header) =>
      isNonArrayObject(header) ? { name: header.name, value: header.value } : header,
    );
  }

  // SAFETY: Legacy object headers are cloned via cloneMetadataRecord while keeping runtime shape.
  return (
    isNonArrayObject(value) ? cloneMetadataRecord(value, true) : value
  ) as EmailMessage["headers"];
}

function snapshotTags(value: EmailMessage["tags"]): EmailMessage["tags"] {
  if (Array.isArray(value)) {
    return copyBoundedArray(value, "Email tags").map((tag) =>
      isNonArrayObject(tag) ? { name: tag.name, value: tag.value } : tag,
    );
  }

  return value;
}

export function snapshotMessageField(
  key: (typeof MESSAGE_FIELDS)[number],
  message: EmailMessage | EmailPersonalizedInput["message"],
): EmailMessage[(typeof MESSAGE_FIELDS)[number]] {
  if (key === "from") {
    const from = message.from;

    return from === undefined ? undefined : snapshotAddressItem(from);
  }

  if (key === "to" && "to" in message) {
    const to = message.to;

    return to === undefined ? undefined : snapshotAddressField(to);
  }

  if (key === "cc" && "cc" in message) {
    const cc = message.cc;

    return cc === undefined ? undefined : snapshotAddressField(cc);
  }

  if (key === "bcc" && "bcc" in message) {
    const bcc = message.bcc;

    return bcc === undefined ? undefined : snapshotAddressField(bcc);
  }

  if (key === "replyTo") {
    const replyTo = message.replyTo;

    return replyTo === undefined ? undefined : snapshotAddressField(replyTo);
  }

  if (key === "headers") {
    const headers = message.headers;

    return headers === undefined ? undefined : snapshotHeaders(headers);
  }

  if (key === "tags") {
    const tags = message.tags;

    return tags === undefined ? undefined : snapshotTags(tags);
  }

  if (key === "attachments") {
    const attachments = message.attachments;

    if (attachments === undefined) return undefined;

    return Array.isArray(attachments)
      ? copyBoundedArray(attachments, "Email attachments").map(snapshotAttachmentItem)
      : attachments;
  }

  if (key === "metadata") {
    const metadata = message.metadata;

    if (metadata === undefined) return undefined;

    return isNonArrayObject(metadata) ? cloneMetadataRecord(metadata, true) : metadata;
  }

  if (key === "subject") return message.subject;

  if (key === "html") return message.html;

  if (key === "text") return message.text;

  if (key === "sendAt") {
    const sendAt = message.sendAt;

    return isDateLike(sendAt) ? new Date(Date.prototype.getTime.call(sendAt)) : sendAt;
  }

  return undefined;
}

const MESSAGE_FIELD_SET: ReadonlySet<PropertyKey> = new Set(MESSAGE_FIELDS);

/**
 * Read each message field once so validation and adapters see identical values
 * even on class instances with getters, and nested objects/arrays are isolated.
 */
export function snapshotMessage(message: EmailMessage): EmailMessage {
  const copy: Partial<EmailMessage> = {};

  for (const key of Reflect.ownKeys(message)) {
    if (MESSAGE_FIELD_SET.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(message, key);

    if (!descriptor?.enumerable) continue;
    Object.defineProperty(copy, key, {
      value: descriptor.get ? descriptor.get.call(message) : descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  for (const key of MESSAGE_FIELDS) {
    const value = snapshotMessageField(key, message);

    if (value === undefined) continue;
    Object.defineProperty(copy, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  // SAFETY: Every EmailMessage field was copied from `message`.
  return copy as EmailMessage;
}

const TEMPLATE_MESSAGE_FIELDS = [
  "from",
  "subject",
  "html",
  "text",
  "replyTo",
  "headers",
  "attachments",
  "tags",
  "metadata",
  "sendAt",
] as const;

const TEMPLATE_EXCLUDED_FIELDS: ReadonlySet<PropertyKey> = new Set([
  ...TEMPLATE_MESSAGE_FIELDS,
  "to",
  "cc",
  "bcc",
]);

export function snapshotTemplateMessage(
  message: EmailPersonalizedInput["message"] | EmailMessage,
): EmailPersonalizedInput["message"] {
  const copy: Partial<EmailPersonalizedInput["message"]> = {};

  for (const key of Reflect.ownKeys(message)) {
    if (TEMPLATE_EXCLUDED_FIELDS.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(message, key);

    if (!descriptor?.enumerable) continue;
    Object.defineProperty(copy, key, {
      value: descriptor.get ? descriptor.get.call(message) : descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  for (const key of TEMPLATE_MESSAGE_FIELDS) {
    const value = snapshotMessageField(key, message);

    if (value === undefined) continue;
    Object.defineProperty(copy, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  // SAFETY: Every template EmailMessage field (excluding to/cc/bcc) was copied once.
  return copy as EmailPersonalizedInput["message"];
}

export function snapshotMessageForSend(message: EmailMessage): EmailMessage {
  try {
    if (!isNonArrayObject(message)) return message;

    return snapshotMessage(message);
  } catch (error) {
    if (error instanceof EmailValidationError) throw error;
    throw new EmailValidationError("Email message could not be read.", error);
  }
}

export function snapshotPersonalizedInputForSend(
  input: EmailPersonalizedInput,
): EmailPersonalizedInput {
  try {
    if (!isNonArrayObject(input)) return input;

    const rawMessage = input.message;

    const safeMessage = isNonArrayObject(rawMessage)
      ? snapshotTemplateMessage(rawMessage)
      : rawMessage;

    const rawRecipients = input.recipients;

    const recipients = Array.isArray(rawRecipients)
      ? copyBoundedArray(rawRecipients, "sendPersonalized recipients").map((recipient) => {
          if (!isNonArrayObject(recipient)) return recipient;

          const to = snapshotAddressItem(recipient.to);
          const rawVars = recipient.variables;

          const variables =
            rawVars !== undefined && isNonArrayObject(rawVars)
              ? cloneMetadataRecord(rawVars, true)
              : rawVars;

          // SAFETY: `to` was snapshotted from `recipient.to` preserving the EmailAddress shape.
          return variables === undefined
            ? { to: to as EmailPersonalizedInput["recipients"][number]["to"] }
            : { to: to as EmailPersonalizedInput["recipients"][number]["to"], variables };
        })
      : rawRecipients;

    return {
      message: safeMessage,
      recipients,
    };
  } catch (error) {
    if (error instanceof EmailValidationError) throw error;
    throw new EmailValidationError("sendPersonalized input could not be read.", error);
  }
}

const MAX_NATIVE_DEPTH = 64;

// Defined, not assigned, so a key such as "__proto__" stays data instead of setting the prototype.
function defineNativeField<V>(record: Record<string, V>, key: string, value: V) {
  Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
}

// A class instance can hold settings in prototype getters that a field copy would silently drop.
function assertPlainNative(record: EmailNativeObject | EmailNativeOptionsMap) {
  const prototype = Object.getPrototypeOf(record);

  if (prototype !== Object.prototype && prototype !== null) {
    throw new EmailValidationError("Native options must be plain objects and arrays.");
  }
}

function isNativeList(value: EmailNativeValue): value is readonly EmailNativeValue[] {
  return Array.isArray(value);
}

function snapshotNativeValue(value: EmailNativeValue, depth: number): EmailNativeValue {
  if (!isObjectLike(value)) return value;

  if (depth > MAX_NATIVE_DEPTH) {
    throw new EmailValidationError("Native options exceed the maximum nesting depth.");
  }

  if (isNativeList(value)) return value.map((item) => snapshotNativeValue(item, depth + 1));

  return snapshotNativeRecord(value, depth);
}

function snapshotNativeRecord(record: EmailNativeObject, depth: number): EmailNativeObject {
  assertPlainNative(record);
  const copy: Record<string, EmailNativeValue> = {};

  for (const key of Object.keys(record)) {
    defineNativeField(copy, key, snapshotNativeValue(record[key], depth + 1));
  }

  return copy;
}

/**
 * Copies one adapter's native entry into plain SDK-owned objects and arrays, reading each field
 * once, so nothing the caller, a hook, or an adapter holds can change the copy that was checked
 * and sent. Class instances are rejected with an `EmailValidationError`.
 */
export function snapshotNativeObject(entry: EmailNativeObject): EmailNativeObject {
  return snapshotNativeRecord(entry, 0);
}

/** Copies a send's `native` map with `snapshotNativeObject` for each own entry. */
export function snapshotNativeMap(native: EmailNativeOptionsMap): EmailNativeOptionsMap {
  assertPlainNative(native);
  const copy: Record<string, EmailNativeObject | undefined> = {};

  for (const key of Object.keys(native)) {
    const entry = native[key];
    defineNativeField(copy, key, isObjectLike(entry) ? snapshotNativeObject(entry) : entry);
  }

  return copy;
}
