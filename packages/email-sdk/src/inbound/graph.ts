import { type JsonObject, jsonString } from "../internal/decode.js";
import { emailFromMime } from "./normalize.js";
import {
  type InboundFetchOptions,
  fetchBytes,
  jsonList,
  jsonObject,
  jsonText,
  parseJsonObjectBody,
  payloadError,
  timingSafeEqual,
  utf8Bytes,
} from "./shared.js";
import {
  type InboundEmail,
  InboundError,
  type InboundRequestPayload,
} from "./types.js";

const provider = "graph";

export interface GraphInboundApiOptions extends InboundFetchOptions {
  /** Return a token with `Mail.Read` (delegated) or `Mail.Read` application permission. */
  getAccessToken: () => string | Promise<string>;
  baseUrl?: string;
}

/** One message change from a Graph subscription on `/users/{id}/messages` or a folder. */
export interface GraphMessageNotification {
  subscriptionId: string;
  changeType: string;
  /** Resource path relative to the Graph root, such as `Users/{id}/Messages/{id}`. */
  resource: string;
  messageId?: string;
  tenantId?: string;
  raw: JsonObject;
}

export interface GraphNotificationOptions {
  /** The `clientState` you set on the subscription. Notifications without it are rejected. */
  clientState: string;
}

/**
 * Answer Graph's subscription validation handshake. Returns a `text/plain` response echoing
 * `validationToken`, or `undefined` when the request is a normal notification.
 */
export function graphValidationResponse(url: string | URL): Response | undefined {
  const token = new URL(url).searchParams.get("validationToken");

  if (token === null) return undefined;

  return new Response(token, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/**
 * Parse a Graph change notification batch and check each entry's `clientState` in constant
 * time. Throws `InboundError` if any entry has a missing or wrong `clientState`.
 */
export function parseGraphNotifications(
  payload: InboundRequestPayload,
  options: GraphNotificationOptions,
): GraphMessageNotification[] {
  if (!options.clientState) {
    throw new InboundError("Graph notifications need the subscription clientState.", { reason: "secret_missing", provider });
  }

  const body = parseJsonObjectBody(provider, payload.body);
  const expected = utf8Bytes(options.clientState);

  return jsonList(body.value).map(entry => {
    const item = jsonObject(entry);
    const subscriptionId = jsonText(item?.subscriptionId);
    const resource = jsonText(item?.resource);
    const clientState = jsonText(item?.clientState);

    if (!item || !subscriptionId || !resource) throw payloadError(provider, "Graph notification is missing subscriptionId or resource.");

    if (!clientState) {
      throw new InboundError("Graph notification has no clientState.", { reason: "signature_missing", provider });
    }

    if (!timingSafeEqual(utf8Bytes(clientState), expected)) {
      throw new InboundError("Graph notification clientState does not match.", { reason: "signature_invalid", provider });
    }

    return {
      subscriptionId,
      changeType: jsonText(item.changeType) ?? "unknown",
      resource,
      messageId: jsonString(item.resourceData ?? null, "id"),
      tenantId: jsonText(item.tenantId),
      raw: item,
    };
  });
}

/**
 * Fetch a received message as MIME (`/$value`) and parse it. Pass a notification's
 * `resource`, or `users/{user}/messages/{id}`.
 */
export async function fetchGraphInboundEmail(resource: string, options: GraphInboundApiOptions): Promise<InboundEmail> {
  const path = resource.replace(/^\/+/, "").replace(/\/\$value$/, "");

  if (!/^(?:users\/[^/]+|me)\/(?:mailFolders\/[^/]+\/)?messages\/[^/?#]+$/i.test(path)) {
    throw payloadError(provider, "Graph resource must be users/{id}/messages/{id} or me/messages/{id}.");
  }

  const baseUrl = (options.baseUrl ?? "https://graph.microsoft.com/v1.0").replace(/\/$/, "");
  const token = await options.getAccessToken();

  const bytes = await fetchBytes(provider, `${baseUrl}/${path}/$value`, {
    headers: { Authorization: `Bearer ${token}` },
    fetch: options.fetch,
    signal: options.signal,
  });

  return emailFromMime({ provider, raw: bytes, id: path.split("/").at(-1) });
}
