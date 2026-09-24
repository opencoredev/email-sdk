import type { EmailAdapterContext, EmailMessage } from "../src/types.js";
import { stubFetch } from "./fetch.js";
import type { JsonValue } from "./json.js";

export const context: EmailAdapterContext = {
  adapter: "test",
  operation: "send",
  attempt: 1,
  idempotencyKey: "idem_123",
};

export const message: EmailMessage = {
  from: "Acme <hello@example.com>",
  to: [{ email: "ada@example.com", name: "Ada" }],
  cc: "cc@example.com",
  bcc: "bcc@example.com",
  replyTo: "reply@example.com",
  subject: "Welcome",
  text: "Hello",
  html: "<p>Hello</p>",
  headers: {
    "X-Test": "yes",
  },
  attachments: [
    {
      filename: "hello.txt",
      content: "hello",
      contentType: "text/plain",
    },
  ],
  tags: [{ name: "kind", value: "welcome" }],
  metadata: {
    userId: "user_123",
  },
};

export const messageWithoutProviderSpecificFields: EmailMessage = {
  ...message,
  headers: undefined,
  tags: undefined,
  metadata: undefined,
};

export const messageWithoutMetadata: EmailMessage = {
  ...message,
  metadata: undefined,
};

export const messageWithoutTagsOrMetadata: EmailMessage = {
  ...message,
  tags: undefined,
  metadata: undefined,
};

export const cloudflareMessage: EmailMessage = {
  ...messageWithoutTagsOrMetadata,
  to: "ada@example.com",
};

export const messageWithoutReplyTo: EmailMessage = {
  ...message,
  replyTo: undefined,
};

export const messageWithoutReplyToOrMetadata: EmailMessage = {
  ...message,
  replyTo: undefined,
  metadata: undefined,
};

export function jsonCapture(body: JsonValue, init?: ResponseInit) {
  const calls: Array<{
    url: string;
    headers: Headers;
    json: any;
  }> = [];

  const fetch = stubFetch(async (input, requestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(requestInit?.headers),
      json: JSON.parse(String(requestInit?.body)),
    });

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        ...Object.fromEntries(new Headers(init?.headers).entries()),
      },
      ...init,
    });
  });

  return { calls, fetch };
}

export function formCapture(body: JsonValue) {
  const calls: Array<{
    url: string;
    headers: Headers;
    form: FormData;
    files: Array<{ field: string; name: string }>;
  }> = [];

  const fetch = stubFetch(async (input, requestInit) => {
    const form = requestInit?.body;

    if (!(form instanceof FormData)) throw new Error("Expected a multipart FormData request body.");

    // forEach, unlike bun-types' entries(), types values as File | string.
    const files: Array<{ field: string; name: string }> = [];
    form.forEach((value, field) => {
      if (value instanceof File) files.push({ field, name: value.name });
    });

    calls.push({
      url: String(input),
      headers: new Headers(requestInit?.headers),
      form,
      files,
    });

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  });

  return { calls, fetch };
}

export function base64(value: string) {
  return Buffer.from(value).toString("base64");
}
