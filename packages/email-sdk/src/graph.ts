import { EmailAdapterError } from "./errors.js";
import { base64Attachments, commonHeadersArray, emailParts } from "./payloads.js";
import type { EmailAdapter, EmailMessage } from "./types.js";
import {
  arrayify,
  builtInAdapterDefinition,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
  toProviderError,
  validateBuiltInAdapter,
} from "./utils.js";

type GraphSharedOptions = {
  user: string;
  baseUrl?: string;
  saveToSentItems?: boolean;
  fetch?: typeof fetch;
};

export type GraphClientSecretOptions = GraphSharedOptions & {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  tokenUrl?: string;
  getAccessToken?: never;
};

export type GraphAccessTokenOptions = GraphSharedOptions & {
  getAccessToken: () => string | Promise<string>;
  tenantId?: never;
  clientId?: never;
  clientSecret?: never;
  tokenUrl?: never;
};

export type GraphAdapterOptions = GraphClientSecretOptions | GraphAccessTokenOptions;

const DEFAULT_BASE_URL = "https://graph.microsoft.com/v1.0";
const TOKEN_REFRESH_SKEW_MS = 60_000;

export function graph(options: GraphAdapterOptions): EmailAdapter<"graph", { baseUrl: string }> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const fetcher = options.fetch ?? fetch;
  const accessToken = createTokenProvider(options, fetcher);

  return {
    name: "graph",
    ...builtInAdapterDefinition("graph"),
    raw: { baseUrl },
    async send(message, context) {
      validateBuiltInAdapter("graph", message);

      const token = await resolveAccessToken(accessToken);
      const response = await fetcher(
        `${baseUrl}/users/${encodeURIComponent(options.user)}/sendMail`,
        {
          method: "POST",
          signal: context.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(await toGraphPayload(message, options.saveToSentItems)),
        },
      );

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailAdapterError(graphErrorMessage(response.status, body), {
          adapter: "graph",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          delivery: response.status < 500 ? "not_sent" : "unknown",
        });
      }

      return {
        adapter: "graph",
      };
    },
  };
}

async function resolveAccessToken(getAccessToken: () => string | Promise<string>) {
  try {
    return await getAccessToken();
  } catch (error) {
    const normalized = toProviderError("graph", error);

    if (normalized instanceof EmailAdapterError && normalized.delivery !== "not_sent") {
      throw new EmailAdapterError(normalized.message, {
        adapter: "graph",
        status: normalized.status,
        retryable: normalized.retryable,
        delivery: "not_sent",
        cause: error,
      });
    }

    throw normalized;
  }
}

function createTokenProvider(options: GraphAdapterOptions, fetcher: typeof fetch) {
  if (options.getAccessToken) {
    return options.getAccessToken;
  }

  const tokenUrl =
    options.tokenUrl ?? `https://login.microsoftonline.com/${options.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: options.clientId,
    client_secret: options.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  let cached: { accessToken: string; refreshAt: number } | undefined;

  return async function accessToken() {
    if (!cached || cached.refreshAt <= Date.now()) {
      cached = await requestAccessToken(fetcher, tokenUrl, body);
    }

    return cached.accessToken;
  };
}

async function requestAccessToken(fetcher: typeof fetch, tokenUrl: string, body: URLSearchParams) {
  const response = await fetcher(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const responseBody = await readErrorBody(response);

  if (!response.ok) {
    throw new EmailAdapterError(graphErrorMessage(response.status, responseBody), {
      adapter: "graph",
      status: response.status,
      retryable: isRetryableStatus(response.status),
      delivery: "not_sent",
    });
  }

  const token = responseBody as { access_token?: string; expires_in?: number } | undefined;

  if (typeof token?.access_token !== "string") {
    throw new EmailAdapterError("graph returned a token response without an access_token.", {
      adapter: "graph",
      retryable: false,
      delivery: "not_sent",
    });
  }

  return {
    accessToken: token.access_token,
    refreshAt: Date.now() + (token.expires_in ?? 3_600) * 1_000 - TOKEN_REFRESH_SKEW_MS,
  };
}

async function toGraphPayload(message: EmailMessage, saveToSentItems?: boolean) {
  const cc = graphRecipients(message.cc);
  const bcc = graphRecipients(message.bcc);
  const replyTo = graphRecipients(message.replyTo);
  const attachments = await base64Attachments(message);

  return {
    message: {
      subject: message.subject,
      body: {
        contentType: message.html ? "HTML" : "Text",
        content: message.html ?? message.text ?? "",
      },
      toRecipients: graphRecipients(message.to),
      ccRecipients: cc.length > 0 ? cc : undefined,
      bccRecipients: bcc.length > 0 ? bcc : undefined,
      replyTo: replyTo.length > 0 ? replyTo : undefined,
      internetMessageHeaders: commonHeadersArray(message),
      attachments: attachments?.map((attachment) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: attachment.filename,
        contentType: attachment.contentType ?? "application/octet-stream",
        contentBytes: attachment.content,
        isInline: attachment.disposition === "inline",
        contentId: attachment.contentId,
      })),
    },
    saveToSentItems,
  };
}

function graphRecipients(addresses: EmailMessage["cc"]) {
  return arrayify(addresses).map((address) => {
    const { email, name } = emailParts(address);
    return { emailAddress: { address: email, name } };
  });
}

function graphErrorMessage(status: number, body: unknown) {
  const record = body as Record<string, unknown> | undefined;

  if (typeof record?.error === "string") {
    const detail = [record.error, record.error_description].filter(Boolean).join(" - ");
    return detail
      ? `graph failed with ${status}: ${detail}`
      : httpErrorMessage("graph", status, body);
  }

  if (record?.error && typeof record.error === "object") {
    const error = record.error as Record<string, unknown>;
    const detail = [error.code, error.message].filter(Boolean).join(" - ");
    return detail
      ? `graph failed with ${status}: ${detail}`
      : httpErrorMessage("graph", status, body);
  }

  return httpErrorMessage("graph", status, body);
}
