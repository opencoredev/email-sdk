import type { JsonObject, JsonValue } from "../internal/decode.js";
import { parseAddressList } from "./mime.js";
import { emailFromMime, mergeSecurity, headerFields } from "./normalize.js";
import {
  jsonList,
  jsonObject,
  jsonText,
  parseJsonObjectBody,
  payloadError,
  readHeader,
  toBytes,
  verdict,
  verifyHmac,
} from "./shared.js";
import {
  type InboundAddress,
  type InboundEmail,
  InboundHeaders,
  type InboundRequestPayload,
  type InboundSecurity,
  type InboundTokenOptions,
  type InboundVerification,
} from "./types.js";

const provider = "mailersend";

/** Verify the `Signature` header: hex HMAC-SHA256 of the raw body with the route's signing secret. */
export async function verifyMailerSendInbound(
  payload: InboundRequestPayload,
  options: InboundTokenOptions,
): Promise<InboundVerification> {
  return verifyHmac("SHA-256", readHeader(payload.headers, "signature"), "hex", options.secret, toBytes(payload.body));
}

/** SPF qualifier characters (RFC 7208) to results. */
function spfQualifier(code: string | undefined): InboundSecurity["spf"] {
  switch (code) {
    case "+":
      return "pass";
    case "-":
      return "fail";
    case "~":
      return "softfail";
    case "?":
      return "neutral";
    default:
      return undefined;
  }
}

function security(data: JsonObject): InboundSecurity {
  const spf = jsonObject(data.spf_check);
  const code = jsonText(spf?.code);
  const dkim = data.dkim_check;

  return {
    spf: spfQualifier(code) ?? verdict(jsonText(spf?.value)),
    dkim: dkim === true ? "pass" : dkim === false ? "fail" : undefined,
  };
}

function addresses(value: JsonValue | undefined): InboundAddress[] {
  return jsonList(jsonObject(value)?.data).flatMap(entry => {
    const item = jsonObject(entry);
    const address = jsonText(item?.email);
    const name = jsonText(item?.name);

    return address ? [name ? { address, name } : { address }] : [];
  });
}

/** Parse a MailerSend inbound route webhook (`type: "inbound.message"`). */
export function parseMailerSendInbound(payload: InboundRequestPayload): InboundEmail {
  const root = parseJsonObjectBody(provider, payload.body);
  const data = jsonObject(root.data);

  if (!data) throw payloadError(provider, "MailerSend inbound webhook has no data object.");

  const recipients = jsonObject(data.recipients);

  const envelope = {
    from: jsonText(jsonObject(data.sender)?.email),
    to: jsonList(recipients?.rcptTo).flatMap(entry => jsonText(jsonObject(entry)?.email) ?? []),
  };

  const raw = jsonText(data.raw);
  const value = { kind: "json" as const, value: root };

  if (raw !== undefined) {
    const email = emailFromMime({ provider, raw, id: jsonText(data.id), envelope, payload: value });
    email.security = mergeSecurity(email.security, security(data));

    return email;
  }

  const headers = new InboundHeaders(Object.entries(jsonObject(data.headers) ?? {}).flatMap(([name, entry]) => {
    const text = jsonText(entry);

    return text === undefined ? [] : [{ name, value: text }];
  }));

  const fields = headerFields(headers);
  const from = jsonObject(data.from);
  const fromAddress = jsonText(from?.email);
  const fromName = jsonText(from?.name);

  return {
    provider,
    ...fields,
    id: jsonText(data.id),
    from: fromAddress ? (fromName ? { address: fromAddress, name: fromName } : { address: fromAddress }) : fields.from,
    to: addresses(recipients?.to).length ? addresses(recipients?.to) : fields.to,
    cc: addresses(recipients?.cc).length ? addresses(recipients?.cc) : parseAddressList(headers.get("cc")),
    subject: jsonText(data.subject) ?? fields.subject,
    text: jsonText(data.text),
    html: jsonText(data.html),
    headers,
    attachments: [],
    security: security(data),
    envelope,
    raw: value,
  };
}
