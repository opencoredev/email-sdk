import type { JsonObject, JsonValue } from "../internal/decode.js";
import { parseAddress } from "./mime.js";
import { emailFromMime, headerFields } from "./normalize.js";
import {
  decodeBase64,
  jsonList,
  jsonObject,
  jsonText,
  parseJsonBody,
  payloadError,
  readHeader,
  utf8Bytes,
  verifySharedToken,
} from "./shared.js";
import {
  type InboundEmail,
  InboundHeaders,
  type InboundRequestPayload,
  type InboundTokenOptions,
  type InboundVerification,
} from "./types.js";

/** Check the `auth_token` SparkPost (and Lettr) send in `X-MessageSystems-Webhook-Token`. */
export function verifySparkPostInbound(
  payload: InboundRequestPayload,
  options: InboundTokenOptions,
): InboundVerification {
  return verifySharedToken(readHeader(payload.headers, "x-messagesystems-webhook-token"), options.secret);
}

function relayHeaders(value: JsonValue | undefined): InboundHeaders {
  return new InboundHeaders(jsonList(value).flatMap(entry => Object.entries(jsonObject(entry) ?? {}).flatMap(([name, item]) => {
    const text = jsonText(item);

    return text === undefined ? [] : [{ name, value: text }];
  })));
}

function emailFromRelay(provider: "sparkpost" | "lettr", relay: JsonObject, event: JsonObject): InboundEmail {
  const content = jsonObject(relay.content);
  const rcpt = jsonText(relay.rcpt_to);
  const envelope = { from: jsonText(relay.msg_from), to: rcpt ? [rcpt] : [] };
  const payload = { kind: "json" as const, value: event };
  const rfc822 = jsonText(content?.email_rfc822);

  if (rfc822 !== undefined) {
    const raw = content?.email_rfc822_is_base64 === true ? decodeBase64(rfc822) : utf8Bytes(rfc822);

    return emailFromMime({ provider, raw, envelope, payload });
  }

  const headers = relayHeaders(content?.headers);
  const fields = headerFields(headers);

  return {
    provider,
    ...fields,
    from: parseAddress(jsonText(relay.friendly_from)) ?? fields.from,
    subject: jsonText(content?.subject) ?? fields.subject,
    text: jsonText(content?.text),
    html: jsonText(content?.html),
    headers,
    attachments: [],
    security: {},
    envelope,
    raw: payload,
  };
}

function parseRelayBatch(provider: "sparkpost" | "lettr", payload: InboundRequestPayload): InboundEmail[] {
  const body = parseJsonBody(provider, payload.body);

  if (!Array.isArray(body)) throw payloadError(provider, `${provider} relay webhook body must be a JSON array.`);

  return body.flatMap(entry => {
    const event = jsonObject(entry);
    const relay = jsonObject(jsonObject(event?.msys)?.relay_message);

    return event && relay ? [emailFromRelay(provider, relay, event)] : [];
  });
}

/** Parse a SparkPost relay webhook batch (`[{ msys: { relay_message } }]`). */
export function parseSparkPostInbound(payload: InboundRequestPayload): InboundEmail[] {
  return parseRelayBatch("sparkpost", payload);
}

/** Parse a Lettr inbound forwarding post. Lettr uses SparkPost's relay format. */
export function parseLettrInbound(payload: InboundRequestPayload): InboundEmail[] {
  return parseRelayBatch("lettr", payload);
}
