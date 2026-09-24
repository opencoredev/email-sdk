import { describe, expect, test } from "bun:test";

import { createEmailClient } from "./core.js";
import {
  EmailAbortError,
  EmailAdapterError,
  EmailRouteError,
  EmailValidationError,
} from "./errors.js";
import { graph } from "./graph.js";
import type { EmailAdapterContext, EmailMessage } from "./types.js";
import { stubFetch } from "../test-support/fetch.js";
import { rejectionOf } from "../test-support/assertions.js";
import type { JsonValue } from "../test-support/json.js";

const tenantId = "11111111-1111-1111-1111-111111111111";

const user = "d4f540b2-6478-4ee3-bdd3-d3a5397d97ac";

const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

const context: EmailAdapterContext = {
  adapter: "graph",
  operation: "send",
  attempt: 1,
};

const message: EmailMessage = {
  from: "sender@example.com",
  to: "recipient@example.com",
  subject: "Welcome",
  text: "Hello",
};

type GraphCall = {
  url: string;
  headers: Headers;
  body: string;
};

function graphCapture(
  options: {
    sendStatus?: number;
    sendBody?: JsonValue;
    tokenStatus?: number;
    tokenBody?: JsonValue;
  } = {},
) {
  const {
    sendStatus = 202,
    sendBody,
    tokenStatus = 200,
    tokenBody = { access_token: "test-token", expires_in: 3600 },
  } = options;

  const calls: GraphCall[] = [];

  const fetch = stubFetch(async (input, requestInit) => {
    const url = String(input);
    calls.push({
      url,
      headers: new Headers(requestInit?.headers),
      body: String(requestInit?.body),
    });

    if (url === tokenUrl) {
      return jsonResponse(tokenBody, tokenStatus);
    }

    return sendBody === undefined
      ? new Response(null, { status: sendStatus })
      : jsonResponse(sendBody, sendStatus);
  });

  return { calls, fetch };
}

function jsonResponse(body: JsonValue, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function graphAdapter(
  fetch: typeof globalThis.fetch,
  options: { saveToSentItems?: boolean; tokenTimeoutMs?: number } = {},
) {
  return graph({
    tenantId,
    clientId: "client-id",
    clientSecret: "client-secret",
    user,
    fetch,
    ...options,
  });
}

function sendMailUrl(mailbox: string) {
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`;
}

function sendMailCall(calls: readonly GraphCall[]) {
  const call = calls.find((entry) => entry.url.includes("/sendMail"));
  expect(call).toBeDefined();

  return call!;
}

function sendMailPayload(calls: readonly GraphCall[]) {
  return JSON.parse(sendMailCall(calls).body);
}

describe("graph capabilities", () => {
  test("declares graph capabilities", () => {
    expect(graphAdapter(graphCapture().fetch).capabilities).toEqual({
      repeatedHeaders: true,
      idempotency: "none",
      scheduling: false,
      personalized: "expanded",
    });
  });
});

describe("graph validation", () => {
  test("accepts a minimal text-only message", () => {
    expect(() => graphAdapter(graphCapture().fetch).validate?.(message, context)).not.toThrow();
  });

  test("rejects unsupported EmailMessage fields", () => {
    const adapter = graphAdapter(graphCapture().fetch);

    expect(() =>
      adapter.validate?.({ ...message, tags: [{ name: "env", value: "test" }] }, context),
    ).toThrow("graph does not support these EmailMessage fields: tags");
    expect(() =>
      adapter.validate?.({ ...message, metadata: { campaign: "welcome" } }, context),
    ).toThrow("graph does not support these EmailMessage fields: metadata");
    expect(() =>
      adapter.validate?.({ ...message, sendAt: new Date(Date.now() + 3_600_000) }, context),
    ).toThrow("graph does not support these EmailMessage fields: sendAt");
  });

  test("rejects custom headers without an x- prefix", () => {
    const adapter = graphAdapter(graphCapture().fetch);

    expect(() =>
      adapter.validate?.(
        {
          ...message,
          headers: [
            {
              name: "List-Unsubscribe",
              value: "<mailto:u@example.com>",
            },
          ],
        },
        context,
      ),
    ).toThrow("graph only supports custom headers with an x- prefix: List-Unsubscribe.");
  });

  test("allows 5 custom headers but rejects a sixth", () => {
    const adapter = graphAdapter(graphCapture().fetch);

    const headers = Array.from({ length: 6 }, (_, index) => ({
      name: `X-Probe-${index + 1}`,
      value: String(index + 1),
    }));

    expect(() =>
      adapter.validate?.({ ...message, headers: headers.slice(0, 5) }, context),
    ).not.toThrow();
    expect(() => adapter.validate?.({ ...message, headers }, context)).toThrow(
      "graph only supports 5 headers per message.",
    );
  });

  test("allows repeated x- header names", () => {
    const adapter = graphAdapter(graphCapture().fetch);

    expect(() =>
      adapter.validate?.(
        {
          ...message,
          headers: [
            { name: "X-Dup", value: "1" },
            { name: "x-dup", value: "2" },
          ],
        },
        context,
      ),
    ).not.toThrow();
  });

  test("allows 1000 combined recipients but rejects the next one", () => {
    const adapter = graphAdapter(graphCapture().fetch);
    const to = Array.from({ length: 800 }, (_, index) => `to${index}@example.com`);
    const cc = Array.from({ length: 201 }, (_, index) => `cc${index}@example.com`);

    expect(() =>
      adapter.validate?.({ ...message, to, cc: cc.slice(0, 200) }, context),
    ).not.toThrow();
    expect(() => adapter.validate?.({ ...message, to, cc }, context)).toThrow(
      "graph only supports 1000 recipients per message.",
    );
  });
});

describe("graph payloads", () => {
  test("maps a text-only message", async () => {
    const capture = graphCapture();

    const response = await graphAdapter(capture.fetch).send(
      { ...message, cc: "Cc <cc@example.com>", bcc: "bcc@example.com" },
      context,
    );

    expect(response).toEqual({
      adapter: "graph",
    });
    expect(capture.calls[0]?.url).toBe(tokenUrl);
    expect(capture.calls[1]?.url).toBe(sendMailUrl(user));
    expect(sendMailPayload(capture.calls)).toEqual({
      message: {
        subject: "Welcome",
        body: { contentType: "Text", content: "Hello" },
        toRecipients: [{ emailAddress: { address: "recipient@example.com" } }],
        ccRecipients: [{ emailAddress: { address: "cc@example.com", name: "Cc" } }],
        bccRecipients: [{ emailAddress: { address: "bcc@example.com" } }],
      },
    });
  });

  test("prefers html over text for the Graph body", async () => {
    const capture = graphCapture();

    await graphAdapter(capture.fetch).send(
      { ...message, html: "<p>Hello</p>", text: "Hello" },
      context,
    );

    expect(sendMailPayload(capture.calls).message.body).toEqual({
      contentType: "HTML",
      content: "<p>Hello</p>",
    });
  });

  test("maps display names for replyTo and forwards repeated headers", async () => {
    const capture = graphCapture();

    await graphAdapter(capture.fetch).send(
      {
        ...message,
        replyTo: "Reply <reply@example.com>",
        headers: [
          { name: "X-Dup", value: "1" },
          { name: "x-dup", value: "2" },
        ],
      },
      context,
    );

    expect(sendMailPayload(capture.calls).message).toMatchObject({
      replyTo: [
        {
          emailAddress: {
            address: "reply@example.com",
            name: "Reply",
          },
        },
      ],
      internetMessageHeaders: [
        { name: "X-Dup", value: "1" },
        { name: "x-dup", value: "2" },
      ],
    });
  });

  test("encodes attachments as Graph fileAttachments", async () => {
    const capture = graphCapture();

    await graphAdapter(capture.fetch).send(
      {
        ...message,
        attachments: [
          {
            filename: "hello.txt",
            content: "hello",
            contentType: "text/plain",
          },
          {
            filename: "inline.png",
            content: Buffer.from("png").toString("base64"),
            contentEncoding: "base64",
            contentType: "image/png",
            disposition: "inline",
            contentId: "logo",
          },
        ],
      },
      context,
    );

    expect(sendMailPayload(capture.calls).message.attachments).toEqual([
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "hello.txt",
        contentType: "text/plain",
        contentBytes: Buffer.from("hello").toString("base64"),
        isInline: false,
      },
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "inline.png",
        contentType: "image/png",
        contentBytes: Buffer.from("png").toString("base64"),
        isInline: true,
        contentId: "logo",
      },
    ]);
  });

  test("sends saveToSentItems only when configured", async () => {
    const configured = graphCapture();
    const omitted = graphCapture();

    await graphAdapter(configured.fetch, { saveToSentItems: false }).send(message, context);
    await graphAdapter(omitted.fetch).send(message, context);

    expect(sendMailPayload(configured.calls).saveToSentItems).toBe(false);
    expect(sendMailPayload(omitted.calls).saveToSentItems).toBeUndefined();
  });

  test("accepts a UPN in place of user ID", async () => {
    const capture = graphCapture();

    await graph({
      tenantId,
      clientId: "client-id",
      clientSecret: "client-secret",
      user: "john.doe@contoso.com",
      fetch: capture.fetch,
    }).send(message, context);

    expect(sendMailCall(capture.calls).url).toBe(sendMailUrl("john.doe@contoso.com"));
  });
});

describe("graph authentication", () => {
  test.each([0, -1, NaN, Infinity, 2_147_483_648])(
    "rejects invalid token timeout %s",
    (tokenTimeoutMs) => {
      expect(() => graphAdapter(graphCapture().fetch, { tokenTimeoutMs })).toThrow(
        "tokenTimeoutMs",
      );
    },
  );

  test("aborts a token wait without cancelling another sender's shared refresh", async () => {
    let tokenRequests = 0;
    let sends = 0;
    let release!: (response: Response) => void;

    const adapter = graphAdapter(
      stubFetch(async (url) => {
        if (String(url) === tokenUrl) {
          tokenRequests++;

          return await new Promise<Response>((resolve) => {
            release = resolve;
          });
        }

        sends++;

        return new Response(null, { status: 202 });
      }),
    );

    const controller = new AbortController();
    const cancelled = adapter.send(message, { ...context, signal: controller.signal });
    const other = adapter.send(message, context);
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(EmailAbortError);
    expect(tokenRequests).toBe(1);
    expect(sends).toBe(0);
    release(Response.json({ access_token: "shared", expires_in: 3600 }));
    await other;
    expect(sends).toBe(1);
  });

  test("does not acquire a token for an already-aborted send", async () => {
    const capture = graphCapture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      graphAdapter(capture.fetch).send(message, {
        ...context,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(EmailAbortError);
    expect(capture.calls).toHaveLength(0);
  });

  test("aborts while an injected token provider is pending", async () => {
    const controller = new AbortController();

    const adapter = graph({
      user,
      getAccessToken: () => new Promise<string>(() => {}),
      fetch: stubFetch(() => {
        throw new Error("An aborted send must not reach Graph");
      }),
    });

    const pending = adapter.send(message, { ...context, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(EmailAbortError);
  });

  test("shares token acquisition and expired-token refresh across concurrent sends", async () => {
    let tokenRequests = 0;
    let release: ((response: Response) => void) | undefined;

    const adapter = graph({
      tenantId,
      clientId: "client-id",
      clientSecret: "client-secret",
      user,
      fetch: stubFetch(async (url) => {
        if (String(url) === tokenUrl) {
          tokenRequests++;

          return await new Promise<Response>((resolve) => {
            release = resolve;
          });
        }

        return new Response(null, { status: 202 });
      }),
    });

    for (const round of [1, 2]) {
      const sends = Promise.all(Array.from({ length: 5 }, () => adapter.send(message, context)));
      expect(tokenRequests).toBe(round);
      // A short-lived token is already inside the refresh window on the next round.
      release!(Response.json({ access_token: `token-${round}`, expires_in: 30 }));
      await sends;
    }
  });

  test("clears a failed shared refresh so later sends can recover", async () => {
    let tokenRequests = 0;

    const adapter = graph({
      tenantId,
      clientId: "client-id",
      clientSecret: "client-secret",
      user,
      fetch: stubFetch(async (url) => {
        if (String(url) === tokenUrl) {
          tokenRequests++;

          if (tokenRequests === 1) return new Response(null, { status: 503 });

          return Response.json({ access_token: "recovered", expires_in: 3600 });
        }

        return new Response(null, { status: 202 });
      }),
    });

    const failed = await Promise.allSettled([
      adapter.send(message, context),
      adapter.send(message, context),
    ]);

    expect(failed.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(tokenRequests).toBe(1);
    await adapter.send(message, context);
    expect(tokenRequests).toBe(2);
  });

  test("uses the configured national-cloud token endpoint and scope", async () => {
    const calls: GraphCall[] = [];
    const tokenUrl = `https://login.microsoftonline.us/${tenantId}/oauth2/v2.0/token`;

    const adapter = graph({
      tenantId,
      clientId: "client-id",
      clientSecret: "client-secret",
      user,
      baseUrl: "https://graph.microsoft.us/v1.0",
      tokenUrl,
      scope: "https://graph.microsoft.us/.default",
      fetch: stubFetch(async (url, init) => {
        calls.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: String(init?.body),
        });

        return String(url) === tokenUrl
          ? Response.json({ access_token: "government-token", expires_in: 3600 })
          : new Response(null, { status: 202 });
      }),
    });

    await adapter.send(message, context);
    expect(calls[0]?.url).toBe(tokenUrl);
    expect(calls[0]?.body).toContain("scope=https%3A%2F%2Fgraph.microsoft.us%2F.default");
    expect(calls[1]?.url).toBe(`https://graph.microsoft.us/v1.0/users/${user}/sendMail`);
  });

  test("exchanges client credentials before sending", async () => {
    const capture = graphCapture();

    await graphAdapter(capture.fetch).send(message, context);

    expect(capture.calls[0]?.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(String(capture.calls[0]?.body)))).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });
    expect(sendMailCall(capture.calls).headers.get("authorization")).toBe("Bearer test-token");
  });

  test("reuses a cached access token across sends", async () => {
    const capture = graphCapture();
    const adapter = graphAdapter(capture.fetch);

    await adapter.send(message, context);
    await adapter.send(message, context);

    expect(capture.calls.filter((call) => call.url === tokenUrl)).toHaveLength(1);
    expect(capture.calls.filter((call) => call.url.includes("/sendMail"))).toHaveLength(2);
  });

  test("uses getAccessToken instead of the token endpoint", async () => {
    const capture = graphCapture();

    const adapter = graph({
      getAccessToken: () => "injected-token",
      user,
      fetch: capture.fetch,
    });

    await adapter.send(message, context);

    expect(capture.calls.some((call) => call.url === tokenUrl)).toBe(false);
    expect(sendMailCall(capture.calls).headers.get("authorization")).toBe("Bearer injected-token");
  });

  test("refreshes a cached built-in token once after a 401", async () => {
    let tokenRequests = 0;
    let sends = 0;

    const fetch = stubFetch(async (input) => {
      if (String(input) === tokenUrl) {
        tokenRequests++;

        return Response.json({ access_token: `token-${tokenRequests}`, expires_in: 3600 });
      }

      sends++;

      return new Response(null, { status: sends === 1 ? 401 : 202 });
    });

    const adapter = graphAdapter(fetch);

    await adapter.send(message, context);

    expect(tokenRequests).toBe(2);
    expect(sends).toBe(2);
  });

  test("does not loop when refreshed built-in tokens also return 401", async () => {
    let tokenRequests = 0;
    let sends = 0;

    const fetch = stubFetch(async (input) => {
      if (String(input) === tokenUrl) {
        tokenRequests++;

        return Response.json({ access_token: `token-${tokenRequests}`, expires_in: 3600 });
      }

      sends++;

      return new Response(null, { status: 401 });
    });

    const adapter = graphAdapter(fetch);
    await expect(adapter.send(message, context)).rejects.toMatchObject({ status: 401 });
    expect(tokenRequests).toBe(2);
    expect(sends).toBe(2);
    await expect(adapter.send(message, context)).rejects.toMatchObject({ status: 401 });
    expect(tokenRequests).toBe(4);
    expect(sends).toBe(4);
  });

  test.each(["fetch", "body"])(
    "releases a timed-out shared token %s for later sends",
    async (stage) => {
      let tokenRequests = 0;
      let hang = true;

      const fetch = stubFetch(async (input) => {
        if (String(input) === tokenUrl) {
          tokenRequests++;

          if (hang)
            return stage === "fetch"
              ? await new Promise<Response>(() => {})
              : new Response(new ReadableStream());

          return Response.json({ access_token: "recovered", expires_in: 3600 });
        }

        return new Response(null, { status: 202 });
      });

      const adapter = graphAdapter(fetch, { tokenTimeoutMs: 10 });

      await expect(adapter.send(message, context)).rejects.toMatchObject({
        retryable: true,
        delivery: "not_sent",
      });
      hang = false;
      await adapter.send(message, context);
      expect(tokenRequests).toBe(2);
    },
  );

  test("an old 401 does not evict a newer cached token", async () => {
    let tokenRequests = 0;
    let sends = 0;
    let releaseOld!: (response: Response) => void;
    let started!: () => void;

    const firstRequest = new Promise<void>((resolve) => {
      started = resolve;
    });

    const adapter = graphAdapter(
      stubFetch(async (input, init) => {
        if (String(input) === tokenUrl) {
          return Response.json({ access_token: `token-${++tokenRequests}`, expires_in: 3600 });
        }

        if (++sends === 1) {
          started();

          return await new Promise<Response>((resolve) => {
            releaseOld = resolve;
          });
        }

        return new Response(null, {
          status: new Headers(init?.headers).get("Authorization") === "Bearer token-1" ? 401 : 202,
        });
      }),
    );

    const first = adapter.send(message, context);
    await firstRequest;
    await adapter.send(message, context);
    releaseOld(new Response(null, { status: 401 }));
    await first;
    expect(tokenRequests).toBe(2);
    expect(sends).toBe(4);
  });

  test("does not refresh custom tokens after a 401", async () => {
    let tokenCalls = 0;
    let sends = 0;

    const adapter = graph({
      getAccessToken: () => {
        tokenCalls++;

        return "custom-token";
      },
      user,
      fetch: stubFetch(async (input) => {
        if (String(input).includes("/sendMail")) {
          sends++;

          return new Response(null, { status: 401 });
        }

        throw new Error("unexpected request");
      }),
    });

    await expect(adapter.send(message, context)).rejects.toMatchObject({ status: 401 });
    expect(tokenCalls).toBe(1);
    expect(sends).toBe(1);
  });
});

describe("graph errors", () => {
  test("maps a Graph error body to EmailAdapterError", async () => {
    const capture = graphCapture({
      sendStatus: 400,
      sendBody: {
        error: {
          code: "InvalidInternetMessageHeader",
          message: "Header name must start with x-.",
        },
      },
    });

    await expect(graphAdapter(capture.fetch).send(message, context)).rejects.toMatchObject({
      name: "EmailAdapterError",
      message:
        "graph failed with 400: InvalidInternetMessageHeader - Header name must start with x-.",
      status: 400,
      retryable: false,
      delivery: "not_sent",
    });
  });

  test("treats throttling as retryable and 5xx delivery as unknown", async () => {
    const throttled = graphCapture({
      sendStatus: 429,
      sendBody: { error: { code: "TooMany" } },
    });

    const serverError = graphCapture({ sendStatus: 503 });

    await expect(graphAdapter(throttled.fetch).send(message, context)).rejects.toMatchObject({
      status: 429,
      retryable: true,
      delivery: "not_sent",
    });
    await expect(graphAdapter(serverError.fetch).send(message, context)).rejects.toMatchObject({
      status: 503,
      retryable: true,
      delivery: "unknown",
    });
  });

  test("requires Graph sendMail to return 202", async () => {
    for (const status of [200, 201, 204]) {
      await expect(
        graphAdapter(graphCapture({ sendStatus: status }).fetch).send(message, context),
      ).rejects.toMatchObject({
        status,
        retryable: false,
        delivery: "unknown",
      });
    }
  });

  test("reports a failed token exchange as not sent", async () => {
    const capture = graphCapture({
      tokenStatus: 401,
      tokenBody: {
        error: "invalid_client",
        error_description: "Invalid client secret.",
      },
    });

    await expect(graphAdapter(capture.fetch).send(message, context)).rejects.toMatchObject({
      message: "graph failed with 401: invalid_client - Invalid client secret.",
      status: 401,
      retryable: false,
      delivery: "not_sent",
    });
    expect(capture.calls.some((call) => call.url.includes("/sendMail"))).toBe(false);
  });

  test("retries a token exchange that previously failed", async () => {
    let tokenStatus = 500;
    const calls: string[] = [];

    const fetch = stubFetch(async (input) => {
      const url = String(input);
      calls.push(url);

      if (url === tokenUrl) {
        const status = tokenStatus;
        tokenStatus = 200;

        return jsonResponse(
          status === 200 ? { access_token: "test-token", expires_in: 3600 } : { error: {} },
          status,
        );
      }

      return new Response(null, { status: 202 });
    });

    const adapter = graphAdapter(fetch);

    await expect(adapter.send(message, context)).rejects.toBeInstanceOf(EmailAdapterError);
    await expect(adapter.send(message, context)).resolves.toMatchObject({
      adapter: "graph",
    });
    expect(calls.filter((url) => url === tokenUrl)).toHaveLength(2);
  });

  test("rejects unsupported fields before any network call", async () => {
    const capture = graphCapture();

    await expect(
      graphAdapter(capture.fetch).send(
        { ...message, tags: [{ name: "env", value: "test" }] },
        context,
      ),
    ).rejects.toBeInstanceOf(EmailValidationError);
    expect(capture.calls).toHaveLength(0);
  });

  test("reports token network failures as retryable and not sent", async () => {
    const email = createEmailClient({
      adapters: [
        graphAdapter(
          stubFetch(async () => {
            throw new TypeError("fetch failed");
          }),
        ),
      ],
    });

    const error = await rejectionOf(email.send(message), EmailRouteError);
    expect(error).toBeInstanceOf(EmailRouteError);
    expect(error.failures[0]).toMatchObject({
      adapter: "graph",
      message: "fetch failed",
      retryable: true,
      delivery: "not_sent",
    });
  });

  test("reports getAccessToken failures as not sent", async () => {
    const capture = graphCapture();

    const email = createEmailClient({
      adapters: [
        graph({
          getAccessToken: () => {
            throw new TypeError("managed identity unavailable");
          },
          user,
          fetch: capture.fetch,
        }),
      ],
    });

    const error = await rejectionOf(email.send(message), EmailRouteError);
    expect(error).toBeInstanceOf(EmailRouteError);
    expect(error.failures[0]).toMatchObject({
      adapter: "graph",
      message: "managed identity unavailable",
      retryable: false,
      delivery: "not_sent",
    });
    expect(capture.calls).toHaveLength(0);
  });
});
