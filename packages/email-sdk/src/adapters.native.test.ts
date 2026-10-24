import { describe, expect, test } from "bun:test";
import { brevo } from "./brevo.js";
import { createEmailClient } from "./core.js";
import { loops } from "./loops.js";
import { mailersend } from "./mailersend.js";
import { mailgun } from "./mailgun.js";
import { defaultsPlugin } from "./plugins-defaults.js";
import { postmark } from "./postmark.js";
import { resend } from "./resend.js";
import { sendgrid } from "./sendgrid.js";
import { ses } from "./ses.js";
import type { EmailAdapter, EmailAdapterContext, EmailMessage } from "./types.js";
import {
  context,
  formCapture,
  jsonCapture,
  messageWithoutMetadata,
  messageWithoutProviderSpecificFields,
} from "../test-support/adapter-fixtures.js";
import { stubFetch } from "../test-support/fetch.js";

const simple: EmailMessage = {
  from: "Acme <hello@example.com>",
  to: "ada@example.com",
  subject: "Welcome",
  html: "<p>Hello</p>",
  text: "Hello",
};

function withNative<Native extends EmailAdapterContext["native"]>(native: Native) {
  return { ...context, native };
}

const sesOptions = { accessKeyId: "a", secretAccessKey: "s", region: "us-east-1" };

describe("provider-native options reach each adapter", () => {
  test("Resend sends a template without html, text, or subject", async () => {
    const capture = jsonCapture({ id: "res_1" });

    await resend({ apiKey: "key", fetch: capture.fetch }).send(
      simple,
      withNative({
        template: { id: "welcome", variables: { NAME: "Ada", COUNT: 2 } },
        topicId: "topic_1",
        headers: { "X-Trace": "t1" },
        body: { subject: "Template subject override" },
      }),
    );

    const json = capture.calls[0]?.json;
    expect(json.template).toEqual({ id: "welcome", variables: { NAME: "Ada", COUNT: 2 } });
    expect(json.topic_id).toBe("topic_1");
    expect(json.subject).toBe("Template subject override");
    expect(json).not.toHaveProperty("html");
    expect(json).not.toHaveProperty("text");
    expect(json.from).toBe("Acme <hello@example.com>");
    expect(capture.calls[0]?.headers.get("x-trace")).toBe("t1");
    // The per-send idempotency key still wins over native request headers.
    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
  });

  test("Postmark switches to the template endpoint and maps tracking and stream", async () => {
    const capture = jsonCapture({ MessageID: "pm_1" });

    await postmark({ serverToken: "t", messageStream: "outbound", fetch: capture.fetch }).send(
      simple,
      withNative({
        template: { alias: "welcome", model: { name: "Ada" }, inlineCss: true },
        messageStream: "broadcast",
        trackOpens: true,
        trackLinks: "HtmlOnly",
        tag: "onboarding",
      }),
    );

    expect(capture.calls[0]?.url).toBe("https://api.postmarkapp.com/email/withTemplate");
    const json = capture.calls[0]?.json;
    expect(json).toMatchObject({
      TemplateAlias: "welcome",
      TemplateModel: { name: "Ada" },
      InlineCss: true,
      MessageStream: "broadcast",
      TrackOpens: true,
      TrackLinks: "HtmlOnly",
      Tag: "onboarding",
      From: "Acme <hello@example.com>",
    });
    expect(json).not.toHaveProperty("Subject");
    expect(json).not.toHaveProperty("HtmlBody");
    expect(json).not.toHaveProperty("TextBody");
    expect(json).not.toHaveProperty("TemplateId");
  });

  test("Postmark without a template keeps the normal endpoint and body", async () => {
    const capture = jsonCapture({ MessageID: "pm_1" });

    await postmark({ serverToken: "t", fetch: capture.fetch }).send(
      simple,
      withNative({ trackOpens: false }),
    );

    expect(capture.calls[0]?.url).toBe("https://api.postmarkapp.com/email");
    expect(capture.calls[0]?.json).toMatchObject({ Subject: "Welcome", TrackOpens: false });
  });

  test("SendGrid maps dynamic templates, asm, IP pool, sandbox, and tracking", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_1" } });

    await sendgrid({ apiKey: "sg", fetch: capture.fetch }).send(
      simple,
      withNative({
        templateId: "d-123",
        dynamicTemplateData: { name: "Ada" },
        asm: { groupId: 42, groupsToDisplay: [42, 43] },
        ipPoolName: "transactional",
        batchId: "batch_1",
        sandboxMode: true,
        tracking: { clicks: false, opens: true },
      }),
    );

    const json = capture.calls[0]?.json;
    expect(json).toMatchObject({
      template_id: "d-123",
      asm: { group_id: 42, groups_to_display: [42, 43] },
      ip_pool_name: "transactional",
      batch_id: "batch_1",
      mail_settings: { sandbox_mode: { enable: true } },
      tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: true } },
    });
    expect(json.tracking_settings).not.toHaveProperty("subscription_tracking");
    expect(json.personalizations[0].dynamic_template_data).toEqual({ name: "Ada" });
    expect(json).not.toHaveProperty("content");
  });

  test("SendGrid personalized template sends merge recipient variables into template data", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_batch" } });

    await sendgrid({ apiKey: "sg", fetch: capture.fetch }).sendPersonalized?.(
      {
        message: { from: "hello@acme.com", subject: "Hi", text: "Hi" },
        recipients: [
          { to: "a@example.com", variables: { name: "Ada" } },
          { to: "b@example.com", variables: { name: "Linus" } },
        ],
      },
      withNative({ templateId: "d-123", dynamicTemplateData: { plan: "pro" } }),
    );

    expect(capture.calls[0]?.json.personalizations).toEqual([
      { to: [{ email: "a@example.com" }], dynamic_template_data: { plan: "pro", name: "Ada" } },
      { to: [{ email: "b@example.com" }], dynamic_template_data: { plan: "pro", name: "Linus" } },
    ]);
  });

  test("SES replaces simple content with a stored template and keeps headers and attachments", async () => {
    const capture = jsonCapture({ MessageId: "ses_1" });

    await ses({ ...sesOptions, configurationSetName: "default", fetch: capture.fetch }).send(
      messageWithoutMetadata,
      withNative({
        template: { name: "Welcome", data: { name: "Ada" } },
        configurationSetName: "marketing",
        listManagement: { contactListName: "users", topicName: "news" },
        feedbackForwardingEmailAddress: "bounces@example.com",
      }),
    );

    const json = capture.calls[0]?.json;
    expect(json.ConfigurationSetName).toBe("marketing");
    expect(json.ListManagementOptions).toEqual({ ContactListName: "users", TopicName: "news" });
    expect(json.FeedbackForwardingEmailAddress).toBe("bounces@example.com");
    expect(json.Content).not.toHaveProperty("Simple");
    expect(json.Content.Template).toMatchObject({
      TemplateName: "Welcome",
      TemplateData: JSON.stringify({ name: "Ada" }),
      Headers: [{ Name: "X-Test", Value: "yes" }],
    });
    expect(json.Content.Template.Attachments[0].FileName).toBe("hello.txt");
  });

  test("SES signs native request headers", async () => {
    const capture = jsonCapture({ MessageId: "ses_1" });

    await ses({ ...sesOptions, fetch: capture.fetch }).send(
      simple,
      withNative({ headers: { "x-amz-trace": "1" } }),
    );

    expect(capture.calls[0]?.headers.get("x-amz-trace")).toBe("1");
    expect(capture.calls[0]?.headers.get("authorization")).toContain("x-amz-trace");
  });

  test("Mailgun maps templates, tracking, test mode, and extra form fields", async () => {
    const capture = formCapture({ id: "mg_1" });

    await mailgun({ apiKey: "mg", domain: "mg.example.com", fetch: capture.fetch }).send(
      simple,
      withNative({
        template: { name: "welcome", version: "v2", variables: { name: "Ada" }, renderText: true },
        tracking: true,
        trackingClicks: "htmlonly",
        trackingOpens: false,
        testMode: true,
        requireTls: true,
        ipPool: "pool_1",
        fields: { "o:dkim": "no", "o:tag": ["a", "b"] },
      }),
    );

    const form = capture.calls[0]?.form;
    expect(form?.get("template")).toBe("welcome");
    expect(form?.get("t:version")).toBe("v2");
    expect(form?.get("t:variables")).toBe(JSON.stringify({ name: "Ada" }));
    expect(form?.get("t:text")).toBe("yes");
    expect(form?.get("o:tracking")).toBe("yes");
    expect(form?.get("o:tracking-clicks")).toBe("htmlonly");
    expect(form?.get("o:tracking-opens")).toBe("no");
    expect(form?.get("o:testmode")).toBe("yes");
    expect(form?.get("o:require-tls")).toBe("yes");
    expect(form?.has("o:skip-verification")).toBe(false);
    expect(form?.get("o:sending-ip-pool")).toBe("pool_1");
    expect(form?.get("o:dkim")).toBe("no");
    expect(form?.getAll("o:tag")).toEqual(["a", "b"]);
    expect(form?.get("subject")).toBe("Welcome");
    expect(form?.has("html")).toBe(false);
    expect(form?.has("text")).toBe(false);
  });

  test("Brevo sends a template with params merged over metadata", async () => {
    const capture = jsonCapture({ messageId: "br_1" });

    await brevo({ apiKey: "br", fetch: capture.fetch }).send(
      { ...simple, metadata: { userId: "u_1", plan: "free" } },
      withNative({ templateId: 7, params: { plan: "pro" }, batchId: "b-1" }),
    );

    const json = capture.calls[0]?.json;
    expect(json).toMatchObject({
      templateId: 7,
      params: { userId: "u_1", plan: "pro" },
      batchId: "b-1",
    });
    expect(json).not.toHaveProperty("subject");
    expect(json).not.toHaveProperty("htmlContent");
    expect(json).not.toHaveProperty("textContent");
  });

  test("Loops overrides the transactional ID and merges data variables", async () => {
    const capture = jsonCapture({ success: true });

    await loops({ apiKey: "lp", transactionalId: "tx_default", fetch: capture.fetch }).send(
      simple,
      withNative({
        transactionalId: "tx_welcome",
        dataVariables: { name: "Ada" },
        addToAudience: true,
      }),
    );

    expect(capture.calls[0]?.json).toMatchObject({
      transactionalId: "tx_welcome",
      addToAudience: true,
      dataVariables: { subject: "Welcome", name: "Ada" },
    });
  });

  test("other JSON adapters accept the body and headers passthrough", async () => {
    const capture = jsonCapture({ id: "ms_1" });

    await mailersend({ apiKey: "ms", fetch: capture.fetch }).send(
      simple,
      withNative({ body: { template_id: "tpl_1", subject: "Override" }, headers: { "X-Trace": "1" } }),
    );

    expect(capture.calls[0]?.json).toMatchObject({ template_id: "tpl_1", subject: "Override" });
    expect(capture.calls[0]?.headers.get("x-trace")).toBe("1");
  });

  test("an empty native entry leaves every request body byte-identical", async () => {
    const senders = [
      (fetch: typeof globalThis.fetch) => resend({ apiKey: "k", fetch }),
      (fetch: typeof globalThis.fetch) => postmark({ serverToken: "t", fetch }),
      (fetch: typeof globalThis.fetch) => sendgrid({ apiKey: "k", fetch }),
      (fetch: typeof globalThis.fetch) => brevo({ apiKey: "k", fetch }),
      (fetch: typeof globalThis.fetch) => loops({ apiKey: "k", transactionalId: "tx", fetch }),
    ];

    for (const create of senders) {
      const bodies: string[] = [];

      const fetch = stubFetch(async (_input, init) => {
        bodies.push(String(init?.body));

        return Response.json({ id: "x" });
      });

      const adapter: EmailAdapter = create(fetch);
      const sendable = adapter.name === "loops" ? simple : messageWithoutProviderSpecificFields;
      await adapter.send(sendable, context);
      await adapter.send(sendable, withNative({}));

      expect(bodies[1]).toBe(bodies[0]);
    }
  });
});

describe("provider-native options through the client", () => {
  function recordingAdapter<const Name extends string>(name: Name, fail: boolean) {
    const seen: Array<EmailAdapterContext["native"]> = [];

    const adapter: EmailAdapter<Name, unknown, unknown, { flag?: string }> = {
      name,
      capabilities: {
        repeatedHeaders: true,
        idempotency: "none",
        scheduling: false,
        personalized: "expanded",
      },
      send(_message, adapterContext) {
        seen.push(adapterContext.native);

        if (fail) throw new Error(`${name} down`);

        return { adapter: name };
      },
    };

    return { adapter, seen };
  }

  test("each adapter in a fallback chain receives only its own entry", async () => {
    const resendBodies: Array<Record<string, string>> = [];

    const resendCapture = stubFetch(async (_input, init) => {
      resendBodies.push(JSON.parse(String(init?.body)));

      return new Response("unavailable", { status: 503 });
    });

    const postmarkCapture = jsonCapture({ MessageID: "pm_1" });

    const client = createEmailClient({
      adapters: [
        resend({ apiKey: "k", fetch: resendCapture }),
        postmark({ serverToken: "t", fetch: postmarkCapture.fetch }),
      ],
      fallback: { adapters: ["postmark"], onUnknownDelivery: "continue" },
      telemetry: false,
    });

    const result = await client.send(simple, {
      native: {
        resend: { template: { id: "welcome" } },
        postmark: { trackOpens: true },
      },
    });

    expect(result.adapter).toBe("postmark");
    expect(resendBodies[0]).toHaveProperty("template");
    expect(resendBodies[0]).not.toHaveProperty("TrackOpens");
    expect(postmarkCapture.calls[0]?.url).toBe("https://api.postmarkapp.com/email");
    expect(postmarkCapture.calls[0]?.json.TrackOpens).toBe(true);
    expect(postmarkCapture.calls[0]?.json).not.toHaveProperty("template");
    expect(postmarkCapture.calls[0]?.json.HtmlBody).toBe("<p>Hello</p>");
  });

  test("adapters without an entry see no native options", async () => {
    const primary = recordingAdapter("primary", true);
    const backup = recordingAdapter("backup", false);

    const client = createEmailClient({
      adapters: [primary.adapter, backup.adapter],
      fallback: { adapters: ["backup"], onUnknownDelivery: "continue" },
      telemetry: false,
    });

    await client.send(simple, { native: { primary: { flag: "only-primary" } } });
    await client.send(simple);

    expect(primary.seen).toEqual([{ flag: "only-primary" }, undefined]);
    expect(backup.seen).toEqual([undefined, undefined]);
  });

  test("sendMany merges per-item entries over batch entries by adapter", async () => {
    const first = recordingAdapter("first", false);
    const second = recordingAdapter("second", false);

    const client = createEmailClient({
      adapters: [first.adapter, second.adapter],
      telemetry: false,
    });

    await client.sendMany(
      [
        { message: simple },
        { message: simple, options: { native: { first: { flag: "item" } } } },
        { message: simple, options: { adapter: "second" } },
      ],
      { native: { first: { flag: "batch" }, second: { flag: "batch-second" } } },
    );

    expect(first.seen).toEqual([{ flag: "batch" }, { flag: "item" }]);
    expect(second.seen).toEqual([{ flag: "batch-second" }]);
  });

  test("middleware that rewrites send options keeps native entries", async () => {
    const only = recordingAdapter("only", false);

    const client = createEmailClient({
      adapters: [only.adapter],
      plugins: [defaultsPlugin({ sendMetadata: { tenant: "t1" } })],
      telemetry: false,
    });

    await client.send(simple, { native: { only: { flag: "kept" } } });

    expect(only.seen).toEqual([{ flag: "kept" }]);
  });

  test("withAdapter forwards native options", async () => {
    const only = recordingAdapter("only", false);
    const client = createEmailClient({ adapters: [only.adapter], telemetry: false });

    await client.withAdapter("only").send(simple, { native: { only: { flag: "routed" } } });

    expect(only.seen).toEqual([{ flag: "routed" }]);
  });

  test("native-personalized sends forward the adapter's entry", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_batch" } });

    const client = createEmailClient({
      adapters: [sendgrid({ apiKey: "sg", fetch: capture.fetch })],
      telemetry: false,
    });

    await client.sendPersonalized(
      {
        message: { from: "hello@acme.com", subject: "Hi", text: "Hi" },
        recipients: [{ to: "a@example.com", variables: { name: "Ada" } }],
      },
      { native: { sendgrid: { templateId: "d-1" } } },
    );

    expect(capture.calls[0]?.json.template_id).toBe("d-1");
    expect(capture.calls[0]?.json.personalizations[0].dynamic_template_data).toEqual({
      name: "Ada",
    });
  });
});
