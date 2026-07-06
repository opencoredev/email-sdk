import type { EmailAddress, EmailMessage, RecipientVariables } from "./types.js";
import {
  arrayify,
  assertMaxItems,
  attachmentToBase64,
  emailAddressOf,
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

export function optionalSingleApiAddress(
  adapter: string,
  field: string,
  addresses: EmailMessage["cc"],
) {
  const values = optionalApiAddresses(addresses);

  if (!values) {
    return undefined;
  }

  assertMaxItems(adapter, field, values, 1);
  return values[0];
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

export type RecipientEntry = {
  to: EmailAddress;
  address: string;
  variables: Record<string, string | number | boolean>;
};

/** Replace `%recipient.key%` tokens; unknown keys are left intact to match native providers. */
export function substituteRecipientVariables(
  text: string,
  variables: Record<string, string | number | boolean>,
): string {
  return text.replace(/%recipient\.([\w-]+)%/g, (token, key) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : token,
  );
}

function recipientVariablesLookup(recipientVariables: RecipientVariables | undefined) {
  const lookup = new Map<string, Record<string, string | number | boolean>>();

  for (const [address, variables] of Object.entries(recipientVariables ?? {})) {
    lookup.set(address.toLowerCase(), variables);
  }

  return lookup;
}

/** One entry per `to` recipient, each paired with its variables (empty object when none). */
export function recipientVariableEntries(message: EmailMessage): RecipientEntry[] {
  const lookup = recipientVariablesLookup(message.recipientVariables);

  return arrayify(message.to).map((to) => {
    const address = emailAddressOf(to);
    return { to, address, variables: lookup.get(address.toLowerCase()) ?? {} };
  });
}

/** Address-keyed map covering every recipient, so providers like Mailgun individualize each one. */
export function recipientVariablesMap(message: EmailMessage): RecipientVariables {
  const map: RecipientVariables = {};

  for (const entry of recipientVariableEntries(message)) {
    map[entry.address] = entry.variables;
  }

  return map;
}

/** Render one single-recipient message with its variables substituted into the content. */
export function expandRecipientMessage(message: EmailMessage, entry: RecipientEntry): EmailMessage {
  return {
    ...message,
    to: entry.to,
    recipientVariables: undefined,
    idempotencyKey: undefined,
    subject: substituteRecipientVariables(message.subject, entry.variables),
    html: message.html ? substituteRecipientVariables(message.html, entry.variables) : undefined,
    text: message.text ? substituteRecipientVariables(message.text, entry.variables) : undefined,
  };
}

export function commonHeadersObject(message: EmailMessage) {
  return headersToObject(message.headers);
}

export function commonHeadersArray(message: EmailMessage) {
  return headersToArray(message.headers);
}

export { formatAddress, formatAddresses };
