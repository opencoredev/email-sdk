import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { brevo } from "./brevo.js";
import { createEmailClient } from "./core.js";
import { loops } from "./loops.js";
import { mailersend } from "./mailersend.js";
import { mailgun } from "./mailgun.js";
import { EmailAdapterError, EmailValidationError } from "./errors.js";
import { defaultsPlugin } from "./plugins-defaults.js";
import { postmark, type PostmarkNativeOptions } from "./postmark.js";
import { resend, type ResendNativeOptions } from "./resend.js";
import { sendgrid } from "./sendgrid.js";
import { ses } from "./ses.js";
import type {
  EmailAdapter,
  EmailAdapterContext,
  EmailMessage,
  EmailNativeObject,
  EmailNativeValue,
} from "./types.js";
import {
  context,
  formCapture,
  jsonCapture,
  messageWithoutMetadata,
  messageWithoutProviderSpecificFields,
} from "../test-support/adapter-fixtures.js";
import { stubFetch } from "../test-support/fetch.js";
import { snapshotNativeObject } from "./internal/snapshot.js";

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
  test("Resend sends a template with the message subject but without html or text", async () => {
    const capture = jsonCapture({ id: "res_1" });

    await resend({ apiKey: "key", fetch: capture.fetch }).send(
      simple,
      withNative({
        template: { id: "welcome", variables: { NAME: "Ada", COUNT: 2 } },
        topicId: "topic_1",
        headers: { "X-Trace": "t1" },
      }),
    );

    const json = capture.calls[0]?.json;
    expect(json.template).toEqual({ id: "welcome", variables: { NAME: "Ada", COUNT: 2 } });
    expect(json.topic_id).toBe("topic_1");
    expect(json.subject).toBe("Welcome");
    expect(json).not.toHaveProperty("html");
    expect(json).not.toHaveProperty("text");
    expect(json.from).toBe("Acme <hello@example.com>");
    expect(capture.calls[0]?.headers.get("x-trace")).toBe("t1");
  });

  test("Resend leaves the subject to the template only when asked", async () => {
    const capture = jsonCapture({ id: "res_1" });

    await resend({ apiKey: "key", fetch: capture.fetch }).send(
      simple,
      withNative({ template: { id: "welcome", useTemplateSubject: true } }),
    );

    const json = capture.calls[0]?.json;
    expect(json.template).toEqual({ id: "welcome" });
    expect(json).not.toHaveProperty("subject");
    expect(json).not.toHaveProperty("html");
    expect(json).not.toHaveProperty("text");
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

  test("Postmark reports no accepted recipients when native body replaces them", async () => {
    const capture = jsonCapture({ MessageID: "pm_1" });
    const adapter = postmark({ serverToken: "t", fetch: capture.fetch });

    const overridden = await adapter.send(simple, withNative({ body: { To: "other@example.com" } }));
    const lowercase = await adapter.send(simple, withNative({ body: { to: "other@example.com" } }));
    const plain = await adapter.send(simple, withNative({ trackOpens: true }));

    expect(capture.calls[0]?.json.To).toBe("other@example.com");
    expect(overridden.accepted).toBeUndefined();
    expect(lowercase.accepted).toBeUndefined();
    expect(plain.accepted).toEqual(["ada@example.com"]);
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

  test("beforeSend middleware that mutates a native entry leaves the caller's options unchanged", async () => {
    const capture = jsonCapture({ id: "re_1" });

    const client = createEmailClient({
      adapters: [resend({ apiKey: "re", fetch: capture.fetch })],
      plugins: [
        {
          id: "mutate-native",
          middleware: [
            {
              beforeSend(event) {
                const entry = event.options?.native?.resend;

                if (entry?.template) Object.assign(entry.template, { id: "mutated" });

                return {};
              },
            },
          ],
        },
      ],
    });

    const options = { native: { resend: { template: { id: "welcome" } } } };

    await client.send(simple, options);
    await client.send(simple, options);

    expect(capture.calls.map((call) => call.json.template?.id)).toEqual(["mutated", "mutated"]);
    expect(options.native.resend.template.id).toBe("welcome");
  });

  test("SendGrid and Mailgun reject recipient-replacing passthroughs when sendPersonalized is called directly", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_batch" } });

    const input = {
      message: { from: "hello@acme.com", subject: "Hi", text: "Hi" },
      recipients: [{ to: "a@example.com", variables: { name: "Ada" } }],
    };

    const adapters = [
      () =>
        sendgrid({ apiKey: "sg", fetch: capture.fetch }).sendPersonalized?.(
          input,
          withNative({ body: { personalizations: [{ to: [{ email: "other@example.com" }] }] } }),
        ),
      () =>
        mailgun({ apiKey: "mg", domain: "mg.example.com", fetch: capture.fetch }).sendPersonalized?.(
          input,
          withNative({ fields: { to: "other@example.com" } }),
        ),
    ];

    for (const send of adapters) {
      await expect(send()).rejects.toBeInstanceOf(EmailValidationError);
    }

    expect(capture.calls).toHaveLength(0);
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
    expect(json.subject).toBe("Welcome");
    expect(json).not.toHaveProperty("htmlContent");
    expect(json).not.toHaveProperty("textContent");
  });

  test("Brevo leaves the subject to the template only when asked", async () => {
    const capture = jsonCapture({ messageId: "br_1" });

    await brevo({ apiKey: "br", fetch: capture.fetch }).send(
      simple,
      withNative({ templateId: 7, useTemplateSubject: true }),
    );

    const json = capture.calls[0]?.json;
    expect(json.templateId).toBe(7);
    expect(json).not.toHaveProperty("subject");
    expect(json).not.toHaveProperty("htmlContent");
    expect(json).not.toHaveProperty("useTemplateSubject");
  });

  test("Brevo ignores useTemplateSubject without a template", async () => {
    const capture = jsonCapture({ messageId: "br_1" });

    await brevo({ apiKey: "br", fetch: capture.fetch }).send(
      simple,
      withNative({ useTemplateSubject: true }),
    );

    expect(capture.calls[0]?.json.subject).toBe("Welcome");
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

describe("personalized sends keep their reported recipients", () => {
  const input = {
    message: { from: "hello@acme.com", subject: "Hi", text: "Hi" },
    recipients: [{ to: "ada@example.com", variables: { name: "Ada" } }],
  };

  const recipientOverrides = {
    sendgrid: { body: { personalizations: [{ to: [{ email: "bob@example.com" }] }] } },
    mailgun: { fields: { to: "bob@example.com" } },
    postmark: { body: { To: "bob@example.com" } },
    resend: { body: { to: ["bob@example.com"] } },
  } as const;

  function clientFor(name: keyof typeof recipientOverrides) {
    const json = jsonCapture({ id: "1", MessageID: "1" });
    const form = formCapture({ id: "1" });

    const adapter = {
      sendgrid: () => sendgrid({ apiKey: "sg", fetch: json.fetch }),
      mailgun: () => mailgun({ apiKey: "mg", domain: "mg.example.com", fetch: form.fetch }),
      postmark: () => postmark({ serverToken: "pm", fetch: json.fetch }),
      resend: () => resend({ apiKey: "re", fetch: json.fetch }),
    }[name]();

    const client = createEmailClient({ adapters: [adapter], telemetry: false });

    return { client, calls: () => json.calls.length + form.calls.length };
  }

  for (const name of ["sendgrid", "mailgun", "postmark", "resend"] as const) {
    test(`${name} rejects a native override that could replace the recipients`, async () => {
      const { client, calls } = clientFor(name);
      const key = name === "mailgun" ? "fields" : "body";

      await expect(
        client.sendPersonalized(input, { native: { [name]: recipientOverrides[name] } }),
      ).rejects.toThrow(
        new EmailValidationError(
          `sendPersonalized can't use native.${name}.${key}, because it can replace the recipients the result reports. Use send() for this message, or the adapter's typed native options.`,
        ),
      );
      expect(calls()).toBe(0);
    });
  }

  test("typed native options and request headers still reach a personalized send", async () => {
    const { client, calls } = clientFor("postmark");

    const result = await client.sendPersonalized(input, {
      native: { postmark: { tag: "welcome", headers: { "X-Trace": "1" } } },
    });

    expect(result.accepted).toEqual(["ada@example.com"]);
    expect(calls()).toBe(1);
  });

  test("an entry for an adapter outside the route doesn't block the send", async () => {
    const { client, calls } = clientFor("resend");

    await client.sendPersonalized(input, { native: { postmark: recipientOverrides.postmark } });

    expect(calls()).toBe(1);
  });
});

describe("native request headers", () => {
  const mailgunOptions = { apiKey: "mg", domain: "mg.example.com" };
  // Every header each adapter sets on its own request, plus the transport's framing headers.
  // Mixed case on purpose: HTTP header names compare case-insensitively.
  const transport = ["Content-Length", "transfer-encoding", "HOST"];

  const cases: Array<{ adapter: (fetch: typeof globalThis.fetch) => EmailAdapter; owned: string[] }> = [
    {
      adapter: (fetch) => resend({ apiKey: "re", fetch }),
      owned: ["authorization", "Content-Type", ...transport],
    },
    {
      adapter: (fetch) => postmark({ serverToken: "pm", fetch }),
      owned: ["accept", "content-type", "X-Postmark-Server-Token", ...transport],
    },
    {
      adapter: (fetch) => sendgrid({ apiKey: "sg", fetch }),
      owned: ["Authorization", "CONTENT-TYPE", ...transport],
    },
    {
      adapter: (fetch) => mailersend({ apiKey: "ms", fetch }),
      owned: ["Authorization", "content-type", ...transport],
    },
    { adapter: (fetch) => brevo({ apiKey: "bv", fetch }), owned: ["API-KEY", "Content-Type", ...transport] },
    { adapter: (fetch) => loops({ apiKey: "lp", transactionalId: "tx", fetch }), owned: ["authorization", "Content-Type", ...transport] },
    {
      adapter: (fetch) => ses({ ...sesOptions, fetch }),
      owned: ["Authorization", "Content-Type", "X-Amz-Date", "x-amz-content-sha256", ...transport],
    },
    {
      adapter: (fetch) => mailgun({ ...mailgunOptions, fetch }),
      owned: ["Authorization", "Content-Type", ...transport],
    },
  ];

  function countingFetch() {
    let calls = 0;

    const fetch = stubFetch(async () => {
      calls += 1;

      return new Response("{}", { headers: { "content-type": "application/json" } });
    });

    return { fetch, calls: () => calls };
  }

  for (const { adapter, owned } of cases) {
    const name = adapter(fetch).name;

    test(`${name} rejects a native header it sets itself, before any request`, async () => {
      const { fetch, calls } = countingFetch();

      for (const header of owned) {
        await expect(
          adapter(fetch).send(simple, withNative({ headers: { "X-Trace": "1", [header]: "native" } })),
        ).rejects.toThrow(
          new EmailValidationError(`${name} sets "${header}" itself, so native.headers can't set it.`),
        );
      }

      expect(calls()).toBe(0);
    });
  }

  // The idempotencyKey send option owns this header, set or not, so a native copy can't pin
  // one key across sends, retries, or the recipients of a personalized send.
  for (const [header, idempotencyKey] of [
    ["Idempotency-Key", undefined],
    ["idempotency-key", undefined],
    ["IDEMPOTENCY-KEY", "idem_123"],
  ] as const) {
    test(`resend always reserves ${header} (idempotencyKey ${idempotencyKey ?? "unset"})`, async () => {
      const { fetch, calls } = countingFetch();

      await expect(
        resend({ apiKey: "re", fetch }).send(simple, {
          ...context,
          idempotencyKey,
          native: { headers: { [header]: "native" } },
        }),
      ).rejects.toThrow(
        new EmailValidationError(
          `resend sets "${header}" itself, so native.headers can't set it. Use the idempotencyKey send option instead.`,
        ),
      );
      expect(calls()).toBe(0);
    });
  }

  test("a personalized Resend send can't reuse one native idempotency key per recipient", async () => {
    const { fetch, calls } = countingFetch();
    const client = createEmailClient({ adapters: [resend({ apiKey: "re", fetch })], telemetry: false });

    await expect(
      client.sendPersonalized(
        {
          message: { from: "hello@acme.com", subject: "Hi", text: "Hi" },
          recipients: [
            { to: "ada@example.com", variables: {} },
            { to: "bob@example.com", variables: {} },
          ],
        },
        { native: { resend: { headers: { "Idempotency-Key": "campaign" } } } },
      ),
    ).rejects.toThrow(EmailValidationError);
    expect(calls()).toBe(0);
  });

  test("a header the adapter doesn't set reaches the request", async () => {
    const json = jsonCapture({ id: "1", MessageID: "1" });
    const form = formCapture({ id: "1" });

    await resend({ apiKey: "re", fetch: json.fetch }).send(simple, withNative({ headers: { "X-Trace": "1" } }));
    await postmark({ serverToken: "pm", fetch: json.fetch }).send(simple, withNative({ headers: { "X-Trace": "1" } }));
    await mailgun({ ...mailgunOptions, fetch: form.fetch }).send(simple, withNative({ headers: { "X-Trace": "1" } }));

    for (const call of [...json.calls, ...form.calls]) {
      expect(call.headers.get("x-trace")).toBe("1");
    }

    // fetch generates Mailgun's multipart Content-Type, boundary included.
    expect(form.calls[0]?.headers.has("content-type")).toBe(false);
  });

  test("Mailgun keeps its multipart framing over the wire with native headers", async () => {
    const received: Array<{
      contentType: string | null;
      trace: string | null;
      fields: Record<string, FormDataEntryValue | null>;
    }> = [];

    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        // formData() fails unless the boundary in Content-Type frames the body.
        const form = await request.formData();

        received.push({
          contentType: request.headers.get("content-type"),
          trace: request.headers.get("x-trace"),
          fields: { from: form.get("from"), subject: form.get("subject"), text: form.get("text") },
        });

        return Response.json({ id: "mg_1" });
      },
    });

    try {
      await mailgun({ ...mailgunOptions, baseUrl: server.url.origin }).send(
        simple,
        withNative({ headers: { "X-Trace": "1" } }),
      );
    } finally {
      await server.stop(true);
    }

    expect(received[0]?.contentType).toStartWith("multipart/form-data; boundary=");
    expect(received[0]?.trace).toBe("1");
    expect(received[0]?.fields).toMatchObject({ from: "Acme <hello@example.com>", subject: "Welcome", text: "Hello" });
  });
});

describe("native entries stay isolated per adapter and attempt", () => {
  const capabilities = {
    repeatedHeaders: true,
    idempotency: "none",
    scheduling: false,
    personalized: "expanded",
  } as const;

  test("each retry receives a fresh copy of the adapter's entry", async () => {
    const seen: Array<string | undefined> = [];

    const flaky: EmailAdapter<"flaky", unknown, unknown, { tag?: string }> = {
      name: "flaky",
      capabilities,
      send(_message, attemptContext) {
        seen.push(attemptContext.native?.tag);

        if (attemptContext.native) Object.assign(attemptContext.native, { tag: "changed" });

        if (attemptContext.attempt === 1) {
          throw new EmailAdapterError("try again", { adapter: "flaky", retryable: true });
        }

        return { adapter: "flaky" };
      },
    };

    const client = createEmailClient({ adapters: [flaky] });
    const options = { native: { flaky: { tag: "original" } }, retry: { maxAttempts: 2, delay: () => 0 } };

    await client.send(simple, options);

    expect(seen).toEqual(["original", "original"]);
    expect(options.native.flaky.tag).toBe("original");
  });

  test("an adapter named like an Object.prototype key gets no inherited entry", async () => {
    const received: Array<{ tag?: string } | undefined> = [];

    const proto: EmailAdapter<"constructor", unknown, unknown, { tag?: string }> = {
      name: "constructor",
      capabilities,
      send(_message, attemptContext) {
        received.push(attemptContext.native);

        return { adapter: "constructor" };
      },
    };

    const client = createEmailClient({
      adapters: [proto, resend({ apiKey: "re", fetch: jsonCapture({ id: "re_1" }).fetch })],
    });

    await client.send(simple, { native: { resend: { topicId: "t" } } });

    expect(received).toEqual([undefined]);
  });

  test("Postmark reports accepted recipients when a JavaScript caller passes body: null", async () => {
    const capture = jsonCapture({ MessageID: "pm_1" });
    const nullBody: PostmarkNativeOptions = JSON.parse('{"body":null}');
    const result = await postmark({ serverToken: "t", fetch: capture.fetch }).send(simple, withNative(nullBody));

    expect(result.accepted).toEqual(["ada@example.com"]);
    expect(capture.calls[0]?.json.To).toBe("ada@example.com");
  });
});

describe("native entries are snapshotted as plain data", () => {
  test("a class-instance entry is rejected before any request", async () => {
    class SendGridEntry {
      [key: string]: EmailNativeValue;

      get sandboxMode() {
        return true;
      }
    }

    const capture = jsonCapture({});
    const client = createEmailClient({ adapters: [sendgrid({ apiKey: "sg", fetch: capture.fetch })] });

    await expect(client.send(simple, { native: { sendgrid: new SendGridEntry() } })).rejects.toBeInstanceOf(
      EmailValidationError,
    );

    expect(capture.calls).toHaveLength(0);
  });

  test("plain objects from another JavaScript realm are accepted", async () => {
    const capture = jsonCapture({ MessageID: "pm_1" });
    const client = createEmailClient({ adapters: [postmark({ serverToken: "t", fetch: capture.fetch })] });
    const model: EmailNativeObject = runInNewContext('({ name: "Ada", items: [{ sku: "a" }] })');

    await client.send(simple, { native: { postmark: { template: { alias: "welcome", model } } } });

    expect(capture.calls[0]?.json.TemplateModel).toEqual({ name: "Ada", items: [{ sku: "a" }] });
  });

  test("a class-instance native map is rejected before any request", async () => {
    class TestEnvironment {
      [adapter: string]: EmailNativeObject | undefined;

      get sendgrid() {
        return { sandboxMode: true };
      }
    }

    const capture = jsonCapture({});
    const client = createEmailClient({ adapters: [sendgrid({ apiKey: "sg", fetch: capture.fetch })] });

    await expect(client.send(simple, { native: new TestEnvironment() })).rejects.toBeInstanceOf(
      EmailValidationError,
    );

    expect(capture.calls).toHaveLength(0);
  });

  test("direct SendGrid sendPersonalized reads a getter-backed native entry once", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_batch" } });
    let reads = 0;

    const attemptContext = {
      ...context,
      get native() {
        reads += 1;

        return reads === 1 ? {} : { body: { personalizations: [{ to: [{ email: "other@example.com" }] }] } };
      },
    };

    const result = await sendgrid({ apiKey: "sg", fetch: capture.fetch }).sendPersonalized?.(
      {
        message: { from: "hello@acme.com", subject: "Hi", text: "Hi" },
        recipients: [{ to: "a@example.com", variables: { name: "Ada" } }],
      },
      attemptContext,
    );

    expect(capture.calls[0]?.json.personalizations[0].to).toEqual([{ email: "a@example.com" }]);
    expect(result?.accepted).toEqual(["a@example.com"]);
    expect(reads).toBe(1);
  });

  test("direct Mailgun sendPersonalized forwards a signal exposed through a getter", async () => {
    const controller = new AbortController();
    const signals: Array<AbortSignal | null | undefined> = [];

    class AttemptContext {
      readonly adapter = "mailgun";
      readonly operation = "personalized";
      readonly attempt = 1;

      get signal() {
        return controller.signal;
      }
    }

    const fetch = stubFetch(async (_input, init) => {
      signals.push(init?.signal);

      return Response.json({ id: "<mg_1>" });
    });

    await mailgun({ apiKey: "mg", domain: "mg.example.com", fetch }).sendPersonalized?.(
      {
        message: { from: "hello@acme.com", subject: "Hi", text: "Hi" },
        recipients: [{ to: "a@example.com", variables: { name: "Ada" } }],
      },
      new AttemptContext(),
    );

    expect(signals).toEqual([controller.signal]);
  });

  test("a native key named __proto__ reaches the request as data", async () => {
    const capture = jsonCapture({ id: "re_1" });
    const client = createEmailClient({ adapters: [resend({ apiKey: "re", fetch: capture.fetch })] });
    const entry: ResendNativeOptions = JSON.parse('{"body":{"tags":[{"name":"__proto__","value":"x"}],"__proto__":{"a":1}}}');

    await client.send(simple, { native: { resend: entry } });

    expect(Object.hasOwn(capture.calls[0]?.json, "__proto__")).toBe(true);
  });
  test("shared references that expand past the node budget are rejected before any request", async () => {
    const capture = jsonCapture({ id: "re_1" });
    const client = createEmailClient({ adapters: [resend({ apiKey: "re", fetch: capture.fetch })] });
    let fanout: EmailNativeValue = "x";

    for (let level = 0; level < 20; level += 1) fanout = [fanout, fanout];

    await expect(
      client.send(simple, { native: { resend: { body: { fanout } } } }),
    ).rejects.toThrow("Native options are too large.");
    expect(capture.calls).toHaveLength(0);
  });

  test("a shared long string that expands past the text budget is rejected", async () => {
    const capture = jsonCapture({ id: "re_1" });
    const client = createEmailClient({ adapters: [resend({ apiKey: "re", fetch: capture.fetch })] });
    const chunk = "x".repeat(1024 * 1024);

    await expect(
      client.send(simple, { native: { resend: { body: { chunks: Array.from({ length: 40 }, () => chunk) } } } }),
    ).rejects.toThrow("Native options are too large.");
    expect(capture.calls).toHaveLength(0);
  });

  test("a cyclic native entry is rejected as a cycle", async () => {
    const capture = jsonCapture({ id: "re_1" });
    const client = createEmailClient({ adapters: [resend({ apiKey: "re", fetch: capture.fetch })] });
    const loop: Record<string, EmailNativeValue> = {};
    loop.self = loop;

    await expect(client.send(simple, { native: { resend: { body: { loop } } } })).rejects.toThrow(
      "Native options must not contain cycles.",
    );
    expect(capture.calls).toHaveLength(0);
  });

  test("a sparse array longer than the node budget is rejected before it is walked", async () => {
    const capture = jsonCapture({ id: "re_1" });
    const client = createEmailClient({ adapters: [resend({ apiKey: "re", fetch: capture.fetch })] });
    const sparse: EmailNativeValue[] = [];
    sparse.length = 2_000_000;

    await expect(client.send(simple, { native: { resend: { body: { sparse } } } })).rejects.toThrow(
      "Native options are too large.",
    );
    expect(capture.calls).toHaveLength(0);
  });

  test("every adapter entry in a send's native map draws on one budget", async () => {
    const capture = jsonCapture({ id: "re_1" });

    const client = createEmailClient({
      adapters: [
        resend({ apiKey: "re", fetch: capture.fetch }),
        postmark({ serverToken: "t", fetch: capture.fetch }),
      ],
    });

    let fanout: EmailNativeValue = "x";

    for (let level = 0; level < 18; level += 1) fanout = [fanout, fanout];

    await expect(
      client.send(simple, {
        native: { resend: { body: { fanout } }, postmark: { body: { fanout } } },
      }),
    ).rejects.toThrow("Native options are too large.");
    expect(capture.calls).toHaveLength(0);
  });

  test("direct SendGrid sendPersonalized rejects a cyclic native entry", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_batch" } });
    const loop: Record<string, EmailNativeValue> = {};
    loop.self = loop;

    await expect(
      sendgrid({ apiKey: "sg", fetch: capture.fetch }).sendPersonalized?.(
        {
          message: { from: "hello@acme.com", subject: "Hi", text: "Hi" },
          recipients: [{ to: "a@example.com", variables: { name: "Ada" } }],
        },
        { ...context, native: { body: { loop } } },
      ),
    ).rejects.toThrow("Native options must not contain cycles.");
    expect(capture.calls).toHaveLength(0);
  });

  test("array holes stay holes in the snapshot", () => {
    const list: EmailNativeValue[] = [];
    list[1] = "b";

    const copy = snapshotNativeObject({ list });

    expect(Array.isArray(copy.list) && copy.list.length).toBe(2);
    expect(Object.hasOwn(copy.list ?? {}, 0)).toBe(false);
    expect(Array.isArray(copy.list) && copy.list[1]).toBe("b");
  });

  test("an inherited array element is copied as before", () => {
    const base: EmailNativeValue[] = [];
    base[1] = "inherited";
    const list: EmailNativeValue[] = Object.setPrototypeOf(["own"], base);
    list.length = 2;

    expect(snapshotNativeObject({ list }).list).toEqual(["own", "inherited"]);
  });

  test("a value shared by sibling fields is still copied to each", async () => {
    const capture = jsonCapture({ id: "re_1" });
    const client = createEmailClient({ adapters: [resend({ apiKey: "re", fetch: capture.fetch })] });
    const shared = { plan: "pro" };

    await client.send(simple, { native: { resend: { body: { a: shared, b: shared } } } });

    expect(capture.calls[0]?.json.a).toEqual({ plan: "pro" });
    expect(capture.calls[0]?.json.b).toEqual({ plan: "pro" });
  });
});
