import type { InboundEmail, InboundEmailAdapter } from "./inbound-types.js";
import { parseAddress, parseAddressList, parseHeaders, parseReferences } from "./inbound-utils.js";

export type GmailInboundOptions = {
  accessToken: string;
  refreshAccessToken?: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  userId?: string;
};

export type GmailSyncOptions = {
  since?: Date;
  maxResults?: number;
};

export type GmailMessageSummary = {
  id: string;
  threadId?: string;
};

export type GmailInboundAdapter = InboundEmailAdapter<{
  mode: "byo-oauth-polling";
}> & {
  sync(options?: GmailSyncOptions): Promise<GmailMessageSummary[]>;
  getMessage(id: string): Promise<unknown>;
};

export function gmailInbound(options: GmailInboundOptions): GmailInboundAdapter {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let accessToken = options.accessToken;
  const userId = options.userId ?? "me";

  const adapter: GmailInboundAdapter = {
    name: "gmail",
    async parse(input) {
      return normalizeGmailMessage(input);
    },
    async sync(syncOptions = {}) {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${userId}/messages`);

      if (syncOptions.maxResults !== undefined) {
        url.searchParams.set("maxResults", String(syncOptions.maxResults));
      }

      if (syncOptions.since) {
        url.searchParams.set("q", `after:${Math.floor(syncOptions.since.getTime() / 1000)}`);
      }

      const body = await gmailFetch(url, { method: "GET" });
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const summaries: GmailMessageSummary[] = [];

      for (const message of messages) {
        if (!message || typeof message !== "object") {
          continue;
        }

        const record = message as Record<string, unknown>;

        if (typeof record.id !== "string") {
          continue;
        }

        summaries.push({
          id: record.id,
          threadId: typeof record.threadId === "string" ? record.threadId : undefined,
        });
      }

      return summaries;
    },
    async getMessage(id) {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${userId}/messages/${id}`);
      url.searchParams.set("format", "full");
      return gmailFetch(url, { method: "GET" });
    },
    raw: {
      mode: "byo-oauth-polling",
    },
  };

  async function gmailFetch(url: URL, init: RequestInit): Promise<Record<string, unknown>> {
    let response = await fetchImpl(url, {
      ...init,
      headers: {
        ...headersObject(init.headers),
        authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.status === 401 && options.refreshAccessToken) {
      accessToken = await options.refreshAccessToken();
      response = await fetchImpl(url, {
        ...init,
        headers: {
          ...headersObject(init.headers),
          authorization: `Bearer ${accessToken}`,
        },
      });
    }

    if (!response.ok) {
      throw new Error(`Gmail API request failed with status ${response.status}.`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  return adapter;
}

function normalizeGmailMessage(input: unknown): InboundEmail {
  const message = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const payload = asGmailPayload(message.payload);
  const headers = gmailHeaders(payload.headers);
  const body = collectGmailBodies(payload);
  const from = parseAddress(headers.From) ?? { email: "" };

  return {
    id: typeof message.id === "string" ? message.id : undefined,
    provider: "gmail",
    from,
    to: parseAddressList(headers.To),
    cc: parseAddressList(headers.Cc),
    bcc: parseAddressList(headers.Bcc),
    replyTo: parseAddressList(headers["Reply-To"]),
    subject: headers.Subject,
    text: body.text,
    html: body.html,
    headers,
    attachments: body.attachments,
    messageId: headers["Message-ID"],
    inReplyTo: headers["In-Reply-To"],
    references: parseReferences(headers.References),
    raw: input,
  };
}

function collectGmailBodies(
  payload: GmailPayload,
): Pick<InboundEmail, "text" | "html" | "attachments"> {
  const result: Pick<InboundEmail, "text" | "html" | "attachments"> = {
    attachments: [],
  };
  const visit = (part: GmailPayload) => {
    const data = typeof part.body?.data === "string" ? decodeBase64Url(part.body.data) : undefined;

    if (part.mimeType === "text/plain" && data && result.text === undefined) {
      result.text = data;
    }

    if (part.mimeType === "text/html" && data && result.html === undefined) {
      result.html = data;
    }

    if (part.filename || part.body?.attachmentId) {
      result.attachments.push({
        filename: part.filename,
        contentType: part.mimeType,
        contentId: gmailHeaders(part.headers)["Content-ID"],
        size: typeof part.body?.size === "number" ? part.body.size : undefined,
        raw: part,
      });
    }

    for (const child of part.parts ?? []) {
      visit(child);
    }
  };

  visit(payload);
  return result;
}

type GmailPayload = {
  mimeType?: string;
  filename?: string;
  headers?: unknown;
  body?: {
    data?: unknown;
    size?: unknown;
    attachmentId?: unknown;
  };
  parts?: GmailPayload[];
};

function asGmailPayload(value: unknown): GmailPayload {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Record<string, unknown>;

  return {
    mimeType: typeof record.mimeType === "string" ? record.mimeType : undefined,
    filename: typeof record.filename === "string" ? record.filename : undefined,
    headers: record.headers,
    body: record.body && typeof record.body === "object" ? record.body : undefined,
    parts: Array.isArray(record.parts) ? record.parts.map(asGmailPayload) : undefined,
  };
}

function gmailHeaders(value: unknown): Record<string, string> {
  return parseHeaders(value);
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function headersObject(headers: RequestInit["headers"]): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}
