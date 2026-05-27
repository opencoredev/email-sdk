import type { EmailMessage } from "./types.js";
import {
  attachmentToBase64,
  formatAddress,
  formatAddresses,
  headersToArray,
  headersToObject,
} from "./utils.js";

export function simpleAddress(address: string) {
  return { email: address };
}

export function emailParts(address: string | { email: string; name?: string }) {
  if (typeof address !== "string") {
    return address;
  }

  const match = address.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);

  if (!match) {
    return { email: address.trim() };
  }

  return {
    email: match[2]?.trim() ?? address.trim(),
    name: match[1]?.trim() || undefined,
  };
}

export function apiAddress(address: string | { email: string; name?: string }) {
  return emailParts(address);
}

export function apiAddresses(addresses: EmailMessage["to"]) {
  return (Array.isArray(addresses) ? addresses : [addresses]).map(apiAddress);
}

export function optionalApiAddresses(addresses: EmailMessage["cc"]) {
  if (!addresses) {
    return undefined;
  }

  return (Array.isArray(addresses) ? addresses : [addresses]).map(apiAddress);
}

export function stringAddresses(addresses: EmailMessage["to"]) {
  return formatAddresses(addresses);
}

export function optionalStringAddresses(addresses: EmailMessage["cc"]) {
  const formatted = formatAddresses(addresses);
  return formatted.length > 0 ? formatted : undefined;
}

export async function base64Attachments(message: EmailMessage) {
  if (!message.attachments) {
    return undefined;
  }

  return Promise.all(
    message.attachments.map(async (attachment) => ({
      filename: attachment.filename,
      content: await attachmentToBase64(attachment),
      contentType: attachment.contentType,
      contentId: attachment.contentId,
      disposition: attachment.disposition,
    })),
  );
}

export async function sendgridAttachments(message: EmailMessage) {
  const attachments = await base64Attachments(message);

  return attachments?.map((attachment) => ({
    filename: attachment.filename,
    content: attachment.content,
    type: attachment.contentType,
    content_id: attachment.contentId,
    disposition: attachment.disposition,
  }));
}

export function commonHeadersObject(message: EmailMessage) {
  return headersToObject(message.headers);
}

export function commonHeadersArray(message: EmailMessage) {
  return headersToArray(message.headers);
}

export { formatAddress, formatAddresses };
