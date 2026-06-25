import { describe, expect, test } from "bun:test";

import {
  EmailProviderError,
  EmailValidationError,
  createEmailClient,
  isRetryableEmailError,
  type EmailMessage,
  type EmailProvider,
} from "@opencoredev/email-sdk";
import { createEmailAgentTools } from "@opencoredev/email-sdk/agent-tools";
import { brevo } from "@opencoredev/email-sdk/brevo";
import { cloudflare } from "@opencoredev/email-sdk/cloudflare";
import { capturePlugin, createEmailCaptureStore } from "@opencoredev/email-sdk/plugins/capture";
import { defaultsPlugin } from "@opencoredev/email-sdk/plugins/defaults";
import {
  observabilityPlugin,
  type EmailObservabilityEvent,
} from "@opencoredev/email-sdk/plugins/observability";
import { jetemail } from "@opencoredev/email-sdk/jetemail";
import { loops } from "@opencoredev/email-sdk/loops";
import { mailchimp } from "@opencoredev/email-sdk/mailchimp";
import { mailersend } from "@opencoredev/email-sdk/mailersend";
import { mailgun } from "@opencoredev/email-sdk/mailgun";
import { mailpace } from "@opencoredev/email-sdk/mailpace";
import { mailtrap } from "@opencoredev/email-sdk/mailtrap";
import { plunk } from "@opencoredev/email-sdk/plunk";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { resend } from "@opencoredev/email-sdk/resend";
import { scaleway } from "@opencoredev/email-sdk/scaleway";
import { sequenzy } from "@opencoredev/email-sdk/sequenzy";
import { sendgrid } from "@opencoredev/email-sdk/sendgrid";
import { ses } from "@opencoredev/email-sdk/ses";
import { smtp } from "@opencoredev/email-sdk/smtp";
import { sparkpost } from "@opencoredev/email-sdk/sparkpost";
import { failingProvider, memoryProvider } from "@opencoredev/email-sdk/testing";
import { zeptomail } from "@opencoredev/email-sdk/zeptomail";

const simpleMessage: EmailMessage = {
  from: { email: "billing@example.com", name: "Billing" },
  to: [{ email: "user@example.com", name: "User" }],
  subject: "Launch smoke",
  html: "<p>Hello</p>",
  text: "Hello",
};

const richMessage: EmailMessage = {
  ...simpleMessage,
  cc: "cc@example.com",
  bcc: "bcc@example.com",
  replyTo: "support@example.com",
  headers: { "X-Smoke": "launch" },
  attachments: [
    {
      filename: "receipt.txt",
      content: "paid",
      contentType: "text/plain",
    },
  ],
  tags: [{ name: "kind", value: "receipt" }],
  metadata: { invoiceId: "inv_123", paid: true },
  idempotencyKey: "email-sdk-launch-smoke",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "x-message-id": "msg_header" },
    ...init,
  });
}

function fetchOk(body: unknown = { id: "msg_123", message_id: "msg_123", messageId: "msg_123" }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    calls.push({ url: String(input), init });
    return jsonResponse(body);
  }) as unknown as typeof fetch;

  return { fetcher, calls };
}

describe("example app client pipeline", () => {
  test("sends with memory adapters, defaults, observability, capture, and agent tools", async () => {
    const memory = memoryProvider("primary");
    const events: EmailObservabilityEvent[] = [];
    const email = createEmailClient({
      adapters: [memory],
      plugins: [
        defaultsPlugin({
          headers: { "X-App": "launch-smoke" },
          metadata: { defaulted: true },
          sendMetadata: { route: "welcome" },
          idempotencyKeyPrefix: "launch",
        }),
        capturePlugin(),
        observabilityPlugin({
          log(event) {
            events.push(event);
          },
        }),
      ],
    });

    const response = await email.send(simpleMessage);
    const tools = createEmailAgentTools(email);
    const toolResponse = await tools.sendEmail.execute({
      from: "agent@example.com",
      to: "user@example.com",
      subject: "Agent path",
      text: "Hello from the tool",
    });

    expect(response.provider).toBe("primary");
    expect(toolResponse).toMatchObject({ provider: "primary" });
    expect(memory.raw?.sent).toHaveLength(2);
    expect(memory.raw?.sent[0]?.message.headers).toMatchObject({ "X-App": "launch-smoke" });
    expect(memory.raw?.sent[0]?.message.metadata).toMatchObject({ defaulted: true });
    expect(email.capture.events.map((event) => event.type)).toEqual([
      "beforeSend",
      "afterSend",
      "beforeSend",
      "afterSend",
    ]);
    expect(events[0]).toMatchObject({
      type: "email.sent",
      provider: "primary",
      message: { toCount: 1, hasHtml: true, hasText: true },
      metadata: { route: "welcome" },
    });
  });

  test("handles retry, fallback, per-send fallback disabling, withAdapter, and batches", async () => {
    let attempts = 0;
    const retrying: EmailProvider = {
      name: "retrying",
      send() {
        attempts += 1;
        if (attempts === 1) {
          throw new EmailProviderError("retry me", { provider: "retrying", retryable: true });
        }
        return { provider: "retrying", id: "ok" };
      },
    };
    const backup = memoryProvider("backup");
    const captureStore = createEmailCaptureStore();
    const email = createEmailClient({
      adapters: [retrying, failingProvider("primary"), backup],
      defaultAdapter: "retrying",
      fallback: ["backup"],
      retry: { retries: 1, delay: () => 0 },
      plugins: [capturePlugin(captureStore)],
    });

    await expect(email.send(simpleMessage)).resolves.toMatchObject({ provider: "retrying" });
    await expect(email.withAdapter("primary").send(simpleMessage)).resolves.toMatchObject({
      provider: "backup",
    });
    await expect(
      email.send(simpleMessage, { adapter: "primary", fallbackAdapters: [] }),
    ).rejects.toThrow("Provider failed");

    const batch = await email.sendBatch([
      { ...simpleMessage, subject: "one", adapter: "backup" },
      { ...simpleMessage, subject: "two", adapter: "missing" },
    ]);

    expect(attempts).toBe(2);
    expect(captureStore.events.map((event) => event.type)).toContain("retry");
    expect(batch[0]).toMatchObject({ ok: true, response: { provider: "backup" } });
    expect(batch[1]).toMatchObject({ ok: false });
  });

  test("validates message shape and retryable provider errors", async () => {
    const email = createEmailClient({ adapters: [memoryProvider()] });

    await expect(
      email.send({ from: "from@example.com", to: "to@example.com", subject: "" }),
    ).rejects.toBeInstanceOf(EmailValidationError);

    expect(
      isRetryableEmailError(new EmailProviderError("busy", { provider: "x", retryable: true })),
    ).toBe(true);
  });
});

describe("documented adapter entry points", () => {
  const adapterCases: Array<[string, EmailProvider, EmailMessage, unknown]> = [
    [
      "resend",
      resend({ apiKey: "test", fetch: fetchOk().fetcher }),
      { ...richMessage, metadata: undefined },
      { id: "resend_1" },
    ],
    [
      "postmark",
      postmark({
        serverToken: "test",
        fetch: fetchOk({ MessageID: "postmark_1", To: "user@example.com" }).fetcher,
      }),
      richMessage,
      { MessageID: "postmark_1" },
    ],
    ["sendgrid", sendgrid({ apiKey: "test", fetch: fetchOk({}).fetcher }), richMessage, {}],
    [
      "cloudflare",
      cloudflare({
        apiToken: "test",
        accountId: "account",
        fetch: fetchOk({ success: true, result: { queued: ["user@example.com"] } }).fetcher,
      }),
      { ...richMessage, to: "user@example.com", tags: undefined, metadata: undefined },
      { success: true },
    ],
    [
      "ses",
      ses({
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        region: "us-east-1",
        fetch: fetchOk({ MessageId: "ses_1" }).fetcher,
      }),
      { ...richMessage, metadata: undefined },
      { MessageId: "ses_1" },
    ],
    [
      "mailgun",
      mailgun({
        apiKey: "test",
        domain: "mg.example.com",
        fetch: fetchOk({ id: "mailgun_1" }).fetcher,
      }),
      richMessage,
      { id: "mailgun_1" },
    ],
    [
      "mailersend",
      mailersend({ apiKey: "test", fetch: fetchOk({ message_id: "mailersend_1" }).fetcher }),
      { ...richMessage, metadata: undefined },
      { message_id: "mailersend_1" },
    ],
    [
      "brevo",
      brevo({ apiKey: "test", fetch: fetchOk({ messageId: "brevo_1" }).fetcher }),
      richMessage,
      { messageId: "brevo_1" },
    ],
    [
      "mailchimp",
      mailchimp({ apiKey: "test", fetch: fetchOk([{ _id: "mailchimp_1" }]).fetcher }),
      { ...richMessage, replyTo: undefined },
      [{ _id: "mailchimp_1" }],
    ],
    [
      "sparkpost",
      sparkpost({ apiKey: "test", fetch: fetchOk({ results: { id: "sparkpost_1" } }).fetcher }),
      { ...richMessage, cc: undefined, bcc: undefined },
      { results: { id: "sparkpost_1" } },
    ],
    [
      "loops",
      loops({ apiKey: "test", transactionalId: "txn", fetch: fetchOk({ id: "loops_1" }).fetcher }),
      { ...simpleMessage, attachments: richMessage.attachments, metadata: richMessage.metadata },
      { id: "loops_1" },
    ],
    [
      "sequenzy",
      sequenzy({ apiKey: "test", fetch: fetchOk({ success: true, jobId: "sequenzy_1" }).fetcher }),
      {
        ...richMessage,
        cc: undefined,
        bcc: undefined,
        headers: undefined,
        tags: undefined,
      },
      { success: true, jobId: "sequenzy_1" },
    ],
    [
      "jetemail",
      jetemail({ apiKey: "test", fetch: fetchOk({ id: "jetemail_1" }).fetcher }),
      { ...richMessage, tags: undefined, metadata: undefined },
      { id: "jetemail_1" },
    ],
    [
      "plunk",
      plunk({ apiKey: "test", fetch: fetchOk({ id: "plunk_1" }).fetcher }),
      { ...richMessage, cc: undefined, bcc: undefined, tags: undefined },
      { id: "plunk_1" },
    ],
    [
      "mailtrap",
      mailtrap({ apiKey: "test", fetch: fetchOk({ message_ids: ["mailtrap_1"] }).fetcher }),
      { ...richMessage, tags: [{ name: "category", value: "receipt" }] },
      { message_ids: ["mailtrap_1"] },
    ],
    [
      "scaleway",
      scaleway({
        secretKey: "test",
        projectId: "project",
        fetch: fetchOk({ id: "scaleway_1" }).fetcher,
      }),
      { ...richMessage, tags: undefined, metadata: undefined },
      { id: "scaleway_1" },
    ],
    [
      "zeptomail",
      zeptomail({ token: "test", fetch: fetchOk({ request_id: "zepto_1" }).fetcher }),
      { ...richMessage, headers: undefined, tags: undefined, metadata: undefined },
      { request_id: "zepto_1" },
    ],
    [
      "mailpace",
      mailpace({ apiKey: "test", fetch: fetchOk({ id: "mailpace_1" }).fetcher }),
      {
        ...simpleMessage,
        cc: "cc@example.com",
        bcc: "bcc@example.com",
        replyTo: "support@example.com",
      },
      { id: "mailpace_1" },
    ],
  ];

  test.each(adapterCases)(
    "%s can send a supported documented shape with mocked network",
    async (name, adapter, message) => {
      const email = createEmailClient({ adapters: [adapter] });
      await expect(email.send(message)).resolves.toMatchObject({ provider: name });
    },
  );

  test("smtp validates unsupported provider-only fields before opening a socket", async () => {
    const email = createEmailClient({ adapters: [smtp({ host: "127.0.0.1", port: 1 })] });

    await expect(email.send(richMessage)).rejects.toThrow("smtp does not support");
  });

  test("narrow adapters fail fast instead of silently dropping unsupported fields", async () => {
    await expect(
      createEmailClient({ adapters: [resend({ apiKey: "test", fetch: fetchOk().fetcher })] }).send(
        richMessage,
      ),
    ).rejects.toThrow("metadata");
    await expect(
      createEmailClient({
        adapters: [loops({ apiKey: "test", transactionalId: "txn", fetch: fetchOk().fetcher })],
      }).send({
        ...simpleMessage,
        to: ["one@example.com", "two@example.com"],
      }),
    ).rejects.toThrow("one recipient");
  });
});
