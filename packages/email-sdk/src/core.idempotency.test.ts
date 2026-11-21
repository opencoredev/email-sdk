import { describe, expect, test } from "bun:test";

import { createEmailTools } from "./ai.js";
import { createEmailClient as createLegacyEmailClient } from "./compat.js";
import { createEmailClient } from "./core.js";
import { EmailRouteError, EmailValidationError } from "./errors.js";
import { defaultsPlugin } from "./plugins-defaults.js";
import { sendgrid } from "./sendgrid.js";
import type { EmailAdapter, EmailAdapterCapabilities, EmailAdapterContext } from "./types.js";
import { adapter, capabilities, message } from "../test-support/core-fixtures.js";
import { jsonCapture } from "../test-support/adapter-fixtures.js";

function recordingAdapter<const Name extends string>(
  name: Name,
  idempotency: EmailAdapterCapabilities["idempotency"],
) {
  const contexts: EmailAdapterContext[] = [];

  const recorded: EmailAdapter<Name> = adapter(
    name,
    (_message, context) => {
      contexts.push(context);

      return { adapter: name, id: `${name}_1` };
    },
    { capabilities: { ...capabilities, idempotency } },
  );

  return { adapter: recorded, contexts };
}

describe("idempotencyKey on an adapter that cannot deduplicate", () => {
  test("send rejects before any request instead of silently dropping the key", async () => {
    const none = recordingAdapter("none", "none");
    const client = createEmailClient({ adapters: [none.adapter], telemetry: false });

    const sending = client.send(message, { idempotencyKey: "order-42" });

    await expect(sending).rejects.toBeInstanceOf(EmailValidationError);
    await expect(sending).rejects.toThrow(/none cannot deduplicate sends/);
    expect(none.contexts).toHaveLength(0);
  });

  test("validate reports the same error, so callers can check a route up front", async () => {
    const none = recordingAdapter("none", "none");
    const client = createEmailClient({ adapters: [none.adapter], telemetry: false });

    await expect(client.validate(message, { idempotencyKey: "order-42" })).rejects.toThrow(
      EmailValidationError,
    );
  });

  test("a fallback adapter without deduplication fails the route before the primary sends", async () => {
    const native = recordingAdapter("native", "native");
    const none = recordingAdapter("none", "none");

    const client = createEmailClient({
      adapters: [native.adapter, none.adapter],
      fallback: { adapters: ["none"] },
      telemetry: false,
    });

    await expect(client.send(message, { idempotencyKey: "order-42" })).rejects.toThrow(
      /none cannot deduplicate sends/,
    );
    expect(native.contexts).toHaveLength(0);
  });

  test("native and message_id adapters keep sending with the key", async () => {
    const native = recordingAdapter("native", "native");
    const messageId = recordingAdapter("messageId", "message_id");

    const client = createEmailClient({
      adapters: [native.adapter, messageId.adapter],
      telemetry: false,
    });

    await client.send(message, { idempotencyKey: "a" });
    await client.send(message, { adapter: "messageId", idempotencyKey: "b" });

    expect(native.contexts[0]?.idempotencyKey).toBe("a");
    expect(messageId.contexts[0]?.idempotencyKey).toBe("b");
  });

  test("sends without a key are unaffected", async () => {
    const none = recordingAdapter("none", "none");
    const client = createEmailClient({ adapters: [none.adapter], telemetry: false });

    await client.send(message);

    expect(none.contexts).toHaveLength(1);
  });

  test("idempotency: best-effort sends and still forwards the key", async () => {
    const none = recordingAdapter("none", "none");
    const client = createEmailClient({ adapters: [none.adapter], telemetry: false });

    await client.send(message, { idempotencyKey: "order-42", idempotency: "best-effort" });

    expect(none.contexts[0]?.idempotencyKey).toBe("order-42");
  });

  test("built-in SendGrid rejects a strict key and sends a best-effort one", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_1" } });

    const client = createEmailClient({
      adapters: [sendgrid({ apiKey: "sg", fetch: capture.fetch })],
      telemetry: false,
    });

    await expect(client.send(message, { idempotencyKey: "k" })).rejects.toThrow(
      EmailValidationError,
    );
    expect(capture.calls).toHaveLength(0);

    await client.send(message, { idempotencyKey: "k", idempotency: "best-effort" });
    expect(capture.calls).toHaveLength(1);
  });

  test("sendPersonalized applies the same check", async () => {
    const none = recordingAdapter("none", "none");
    const client = createEmailClient({ adapters: [none.adapter], telemetry: false });

    const sending = client.sendPersonalized(
      {
        message: { from: "a@example.com", subject: "Hi", text: "Hi" },
        recipients: [{ to: "b@example.com", variables: {} }],
      },
      { idempotencyKey: "campaign" },
    );

    await expect(sending).rejects.toThrow(EmailValidationError);
    expect(none.contexts).toHaveLength(0);
  });

  test("sendMany reports the error per item and keeps sending the others", async () => {
    const none = recordingAdapter("none", "none");
    const client = createEmailClient({ adapters: [none.adapter], telemetry: false });

    const results = await client.sendMany([
      { message, options: { idempotencyKey: "a" } },
      { message },
    ]);

    expect(results.map((result) => result.ok)).toEqual([false, true]);
    expect(results[0]?.ok === false && results[0].error).toBeInstanceOf(EmailValidationError);
  });

  test("a defaultsPlugin idempotencyKey is held to the same rule", async () => {
    const none = recordingAdapter("none", "none");

    const client = createEmailClient({
      adapters: [none.adapter],
      plugins: [defaultsPlugin({ idempotencyKey: "default-key" })],
      telemetry: false,
    });

    await expect(client.send(message)).rejects.toThrow(EmailValidationError);
    expect(none.contexts).toHaveLength(0);
  });

  test("the error is a validation error, not a route failure, so fallback never runs", async () => {
    const none = recordingAdapter("none", "none");
    const client = createEmailClient({ adapters: [none.adapter], telemetry: false });

    const error = await client.send(message, { idempotencyKey: "k" }).catch((cause: unknown) => cause);

    expect(error).not.toBeInstanceOf(EmailRouteError);
  });
});

describe("SDK callers that set idempotencyKey on every send", () => {
  test("the AI email tool still sends through an adapter without deduplication", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_ai" } });

    const client = createEmailClient({
      adapters: [sendgrid({ apiKey: "sg", fetch: capture.fetch })],
      telemetry: false,
    });

    const email = createEmailTools({ client, from: "sender@example.com" });

    const output = await email.tools.sendEmail.execute?.(
      { to: ["user@example.com"], subject: "Hi", text: "Hi" },
      { toolCallId: "call_1", messages: [], context: undefined },
    );

    expect(output).toMatchObject({ status: "sent", adapter: "sendgrid" });
    expect(capture.calls).toHaveLength(1);
  });

  test("the legacy compat client keeps forwarding the key without the strict check", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_legacy" } });

    const client = createLegacyEmailClient({
      adapters: [sendgrid({ apiKey: "sg", fetch: capture.fetch })],
      telemetry: false,
    });

    await client.send(message, { idempotencyKey: "legacy" });

    expect(capture.calls).toHaveLength(1);
  });
});
