import { EmailAbortError, EmailAdapterError } from "./errors.js";
import { isJsonObject, isJsonString, jsonField, jsonString } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
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
  scope?: string;
  tokenTimeoutMs?: number;
  getAccessToken?: never;
};

export type GraphAccessTokenOptions = GraphSharedOptions & {
  getAccessToken: () => string | Promise<string>;
  tokenTimeoutMs?: never;
  tenantId?: never;
  clientId?: never;
  clientSecret?: never;
  tokenUrl?: never;
  scope?: never;
};

export type GraphAdapterOptions = GraphClientSecretOptions | GraphAccessTokenOptions;

const DEFAULT_BASE_URL = "https://graph.microsoft.com/v1.0";

const TOKEN_REFRESH_SKEW_MS = 60_000;

const DEFAULT_TOKEN_TIMEOUT_MS = 30_000;

const MAX_TIMER_DELAY_MS = 2_147_483_647;

type TokenProvider = {
  get: () => string | Promise<string>;
  invalidate: (token: string) => boolean;
};

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

      let token = await resolveAccessToken(accessToken, context.signal);
      const payload = JSON.stringify(await toGraphPayload(message, options.saveToSentItems));

      let response = await sendGraphMessage(
        fetcher,
        baseUrl,
        options.user,
        token,
        payload,
        context.signal,
      );

      if (response.status === 401 && accessToken.invalidate(token)) {
        void response.body?.cancel().catch(() => {});
        token = await resolveAccessToken(accessToken, context.signal);
        response = await sendGraphMessage(
          fetcher,
          baseUrl,
          options.user,
          token,
          payload,
          context.signal,
        );

        if (response.status === 401) accessToken.invalidate(token);
      }

      if (!response.ok || response.status !== 202) {
        const body = await readErrorBody(response);
        throw new EmailAdapterError(graphErrorMessage(response.status, body), {
          adapter: "graph",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          delivery:
            response.status >= 200 && response.status < 300
              ? "unknown"
              : response.status < 500
                ? "not_sent"
                : "unknown",
        });
      }

      return {
        adapter: "graph",
      };
    },
  };
}

async function sendGraphMessage(
  fetcher: typeof fetch,
  baseUrl: string,
  user: string,
  token: string,
  payload: string,
  signal?: AbortSignal,
) {
  return fetcher(`${baseUrl}/users/${encodeURIComponent(user)}/sendMail`, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: payload,
  });
}

async function resolveAccessToken(provider: TokenProvider, signal?: AbortSignal) {
  try {
    if (signal?.aborted) throw new EmailAbortError(signal.reason);
    const token = provider.get();

    if (!signal) return await token;

    // Cancel this sender's wait, not the refresh shared with other senders.
    return await new Promise<string>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(new EmailAbortError(signal.reason));
      };

      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(token).then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );

      if (signal.aborted) abort();
    });
  } catch (error) {
    if (error instanceof EmailAbortError) throw error;
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
    return { get: options.getAccessToken, invalidate: () => false };
  }

  const tokenUrl =
    options.tokenUrl ?? `https://login.microsoftonline.com/${options.tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: options.clientId,
    client_secret: options.clientSecret,
    scope: options.scope ?? "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  let cached: { accessToken: string; refreshAt: number } | undefined;
  let refreshing: Promise<NonNullable<typeof cached>> | undefined;
  const tokenTimeoutMs = options.tokenTimeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS;

  if (
    !Number.isFinite(tokenTimeoutMs) ||
    tokenTimeoutMs <= 0 ||
    tokenTimeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new Error(
      "graph tokenTimeoutMs must be finite, positive, and no greater than 2147483647.",
    );
  }

  return {
    get: async function accessToken() {
      if (cached && cached.refreshAt > Date.now()) {
        return cached.accessToken;
      }

      refreshing ??= requestAccessToken(fetcher, tokenUrl, body, tokenTimeoutMs)
        .then((token) => (cached = token))
        .finally(() => {
          refreshing = undefined;
        });

      return (await refreshing).accessToken;
    },
    invalidate(token: string) {
      if (cached?.accessToken === token) cached = undefined;

      return true;
    },
  };
}

async function requestAccessToken(
  fetcher: typeof fetch,
  tokenUrl: string,
  body: URLSearchParams,
  timeoutMs: number,
) {
  const controller = new AbortController();

  const request = fetcher(tokenUrl, {
    method: "POST",
    signal: controller.signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  }).then(async (response) => ({ response, body: await readErrorBody(response) }));

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new EmailAdapterError("graph token acquisition timed out.", {
          adapter: "graph",
          retryable: true,
          delivery: "not_sent",
        }),
      );
      controller.abort();
    }, timeoutMs);
  });

  const { response, body: responseBody } = await Promise.race([request, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });

  if (!response.ok) {
    throw new EmailAdapterError(graphErrorMessage(response.status, responseBody), {
      adapter: "graph",
      status: response.status,
      retryable: isRetryableStatus(response.status),
      delivery: "not_sent",
    });
  }

  const accessToken = jsonString(responseBody, "access_token");

  if (accessToken === undefined) {
    throw new EmailAdapterError("graph returned a token response without an access_token.", {
      adapter: "graph",
      retryable: false,
      delivery: "not_sent",
    });
  }

  return {
    accessToken,
    // Some Microsoft identity endpoints send expires_in as a numeric string.
    refreshAt:
      Date.now() +
      Number(jsonField(responseBody, "expires_in") ?? 3_600) * 1_000 -
      TOKEN_REFRESH_SKEW_MS,
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

function graphErrorMessage(status: number, body: JsonValue | undefined) {
  const error = jsonField(body, "error");

  if (isJsonString(error)) {
    const detail = [error, jsonField(body, "error_description")].filter(Boolean).join(" - ");

    return detail
      ? `graph failed with ${status}: ${detail}`
      : httpErrorMessage("graph", status, body);
  }

  if (isJsonObject(error)) {
    const detail = [jsonField(error, "code"), jsonField(error, "message")]
      .filter(Boolean)
      .join(" - ");

    return detail
      ? `graph failed with ${status}: ${detail}`
      : httpErrorMessage("graph", status, body);
  }

  return httpErrorMessage("graph", status, body);
}
