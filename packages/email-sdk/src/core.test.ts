import { describe, expect, test } from "bun:test";

import { createEmailClient } from "./core.js";
import { EmailProviderError, EmailSdkError, EmailValidationError } from "./errors.js";
import { postmark } from "./postmark.js";
import {
  resetTelemetry,
  setSharedTelemetry,
  setTelemetrySource,
  type CaptureExceptionContext,
  type Telemetry,
  type TelemetryEventName,
  type TelemetryProperties,
} from "./telemetry.js";
import { failingProvider, memoryProvider } from "./testing.js";
import type { EmailMessage, EmailProvider, EmailProviderContext } from "./types.js";

const message = {
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Welcome",
  text: "Hello",
};

describe("createEmailClient", () => {
  test("sends with the default provider", async () => {
    const provider = memoryProvider();
    const client = createEmailClient({ adapters: [provider] });

    const response = await client.send(message);

    expect(response.provider).toBe("memory");
    expect(provider.raw.sent).toHaveLength(1);
  });

  test("falls back to another provider", async () => {
    const client = createEmailClient({
      adapters: [failingProvider(), memoryProvider("backup")],
      fallback: ["backup"],
    });

    const response = await client.send(message);

    expect(response.provider).toBe("backup");
  });

  test("keeps legacy provider aliases working", async () => {
    const client = createEmailClient({
      providers: [failingProvider(), memoryProvider("backup")],
    });

    const response = await client.send(message, {
      provider: "failing",
      fallbackProviders: ["backup"],
    });

    expect(response.provider).toBe("backup");
    expect(client.providers.get("backup")).toBe(client.adapters.get("backup"));
  });

  test("supports adapter-first routing aliases", async () => {
    const client = createEmailClient({
      adapters: [memoryProvider("primary"), memoryProvider("backup")],
      defaultAdapter: "primary",
    });

    const response = await client.send(message, {
      adapter: "backup",
    });

    expect(client.defaultAdapter).toBe("primary");
    expect(client.adapter("backup")).toBe(client.provider("backup"));
    expect(response.provider).toBe("backup");
  });

  test("retries retryable provider errors", async () => {
    let attempts = 0;
    const provider = {
      name: "retry",
      send() {
        attempts += 1;

        if (attempts === 1) {
          throw new EmailProviderError("Temporary failure", {
            provider: "retry",
            retryable: true,
          });
        }

        return {
          provider: "retry",
          id: "ok",
        };
      },
    };

    const client = createEmailClient({
      adapters: [provider],
      retry: {
        retries: 1,
        delay: () => 0,
      },
    });

    const response = await client.send(message);

    expect(response.id).toBe("ok");
    expect(attempts).toBe(2);
  });

  test("validates message content", async () => {
    const client = createEmailClient({ adapters: [memoryProvider()] });

    await expect(
      client.send({
        from: "hello@example.com",
        to: "user@example.com",
        subject: "No body",
      }),
    ).rejects.toBeInstanceOf(EmailValidationError);
  });

  test("validates sendAt before any adapter runs", async () => {
    const provider = memoryProvider();
    const client = createEmailClient({ adapters: [provider] });

    await expect(client.send({ ...message, sendAt: "not-a-date" })).rejects.toThrow(
      'Email message sendAt is not a valid date: "not-a-date".',
    );
    expect(provider.raw.sent).toHaveLength(0);

    const response = await client.send({ ...message, sendAt: new Date("2026-07-10T12:30:00Z") });
    expect(response.provider).toBe("memory");
  });

  test("sendAt on a fallback route without scheduling support fails instead of sending unscheduled", async () => {
    let fallbackRequests = 0;
    const backup = postmark({
      serverToken: "server",
      fetch: () => {
        fallbackRequests += 1;
        throw new Error("unreachable — postmark must reject sendAt before any request");
      },
    });

    const client = createEmailClient({
      adapters: [failingProvider(), backup],
      fallback: ["postmark"],
    });

    const error = await client
      .send({ ...message, sendAt: new Date("2026-07-10T12:30:00Z") })
      .then(() => {
        throw new Error("send should have failed");
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EmailSdkError);
    expect((error as EmailSdkError).code).toBe("all_providers_failed");

    // The fallback's rejection is recorded as an EmailProviderError wrapping the
    // adapter's EmailValidationError (toProviderError keeps the original as `cause`).
    const failures = (error as EmailSdkError).details as EmailProviderError[];
    const fallbackFailure = failures.find((failure) => failure.provider === "postmark");
    expect(fallbackFailure?.message).toBe(
      "postmark does not support these EmailMessage fields: sendAt.",
    );
    expect(fallbackFailure?.cause).toBeInstanceOf(EmailValidationError);
    expect(fallbackRequests).toBe(0);
  });

  test("captures batch failures without throwing", async () => {
    const client = createEmailClient({ adapters: [memoryProvider()] });
    const results = await client.sendBatch([
      message,
      {
        from: "hello@example.com",
        to: "user@example.com",
        subject: "Missing body",
      },
    ]);

    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
  });

  test("lets item-level provider aliases override batch-level adapter aliases", async () => {
    const client = createEmailClient({
      adapters: [memoryProvider("primary"), memoryProvider("secondary")],
    });

    const [result] = await client.sendBatch([{ ...message, provider: "secondary" }], {
      adapter: "primary",
    });

    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.response.provider).toBe("secondary");
    }
  });

  test("retries transient runtime errors from provider transports", async () => {
    let attempts = 0;
    const provider = {
      name: "runtime",
      send() {
        attempts += 1;

        if (attempts === 1) {
          throw new TypeError("fetch failed");
        }

        return {
          provider: "runtime",
          id: "ok",
        };
      },
    };

    const client = createEmailClient({
      adapters: [provider],
      retry: {
        retries: 1,
        delay: () => 0,
      },
    });

    const response = await client.send(message);

    expect(response.id).toBe("ok");
    expect(attempts).toBe(2);
  });

  test("does not retry programming TypeErrors from provider transports", async () => {
    let attempts = 0;
    const provider = {
      name: "runtime",
      send() {
        attempts += 1;
        throw new TypeError("Cannot read properties of null (reading 'apiKey')");
      },
    };

    const client = createEmailClient({
      adapters: [provider],
      retry: {
        retries: 1,
        delay: () => 0,
      },
    });

    await expect(client.send(message)).rejects.toThrow("Cannot read properties");
    expect(attempts).toBe(1);
  });

  test("does not retry ENOTFOUND runtime errors", async () => {
    let attempts = 0;
    const provider = {
      name: "runtime",
      send() {
        attempts += 1;
        throw Object.assign(new Error("getaddrinfo ENOTFOUND api.example.com"), {
          code: "ENOTFOUND",
        });
      },
    };

    const client = createEmailClient({
      adapters: [provider],
      retry: {
        retries: 1,
        delay: () => 0,
      },
    });

    await expect(client.send(message)).rejects.toThrow("ENOTFOUND");
    expect(attempts).toBe(1);
  });

  test("does not retry runtime errors with unrelated reset messages", async () => {
    let attempts = 0;
    const provider = {
      name: "runtime",
      send() {
        attempts += 1;
        throw new Error("password reset link expired");
      },
    };

    const client = createEmailClient({
      adapters: [provider],
      retry: {
        retries: 1,
        delay: () => 0,
      },
    });

    await expect(client.send(message)).rejects.toThrow("password reset");
    expect(attempts).toBe(1);
  });

  test("reports the final retry attempt to onError", async () => {
    const attempts: number[] = [];
    const client = createEmailClient({
      adapters: [
        failingProvider(
          "failing",
          new EmailProviderError("Temporary failure", {
            provider: "failing",
            retryable: true,
          }),
        ),
      ],
      retry: {
        retries: 1,
        delay: () => 0,
      },
      hooks: {
        onError(event) {
          attempts.push(event.attempt);
        },
      },
    });

    await expect(client.send(message)).rejects.toBeInstanceOf(EmailProviderError);
    expect(attempts).toEqual([2]);
  });

  test("does not let hook failures mask provider errors", async () => {
    const client = createEmailClient({
      adapters: [failingProvider()],
      hooks: {
        onError() {
          throw new Error("hook failed");
        },
      },
    });

    await expect(client.send(message)).rejects.toMatchObject({
      provider: "failing",
    });
  });
});

const batchMessage: EmailMessage = {
  from: "Acme <hello@acme.com>",
  to: ["a@example.com", "b@example.com"],
  subject: "Hi %recipient.name%",
  html: '<p>Hi %recipient.name%</p><a href="https://acme.com/u?id=%recipient.id%">Unsub</a>',
  recipientVariables: {
    "a@example.com": { name: "Ada", id: "u_1" },
    "b@example.com": { name: "Linus", id: "u_2" },
  },
};

describe("recipientVariables", () => {
  test("routes to a native sendBulk in a single call", async () => {
    const { provider, calls } = recordingProvider("native", { bulk: true });
    const client = createEmailClient({ adapters: [provider] });

    const response = await client.send(batchMessage);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe("sendBulk");
    expect(calls[0]?.message.to).toEqual(["a@example.com", "b@example.com"]);
    expect(calls[0]?.message.recipientVariables).toEqual(batchMessage.recipientVariables);
    expect(response.provider).toBe("native");
  });

  test("invokes sendBulk on the provider so class-based adapters keep `this`", async () => {
    class ClassProvider implements EmailProvider {
      name = "class";
      apiKey = "secret_key";

      send() {
        return { provider: this.name, id: "single" };
      }

      sendBulk() {
        // Regression: a detached `perform: provider.sendBulk` loses `this`, making
        // fields like apiKey silently undefined for class-based adapters.
        return { provider: this.name, id: this.apiKey };
      }
    }

    const client = createEmailClient({ adapters: [new ClassProvider()] });

    const response = await client.send(batchMessage);

    expect(response.provider).toBe("class");
    expect(response.id).toBe("secret_key");
  });

  test("expands per recipient when the adapter has no native batch", async () => {
    const provider = memoryProvider();
    const client = createEmailClient({ adapters: [provider] });

    const response = await client.send(batchMessage);

    expect(provider.raw.sent).toHaveLength(2);
    const [first, second] = provider.raw.sent;
    expect(first?.message.to).toBe("a@example.com");
    expect(first?.message.subject).toBe("Hi Ada");
    expect(first?.message.html).toContain("Hi Ada");
    expect(first?.message.html).toContain("id=u_1");
    expect(first?.message.recipientVariables).toBeUndefined();
    expect(second?.message.subject).toBe("Hi Linus");
    expect(second?.message.html).toContain("id=u_2");

    expect(response.provider).toBe("memory");
    expect(response.accepted).toEqual(["a@example.com", "b@example.com"]);
  });

  test("substitutes html and text and keeps regex-special values literal", async () => {
    const provider = memoryProvider();
    const client = createEmailClient({ adapters: [provider] });

    await client.send({
      from: "hello@example.com",
      to: ["a@example.com"],
      subject: "Hi %recipient.name%",
      html: "<p>%recipient.name% owes %recipient.amount%</p>",
      text: "%recipient.name% owes %recipient.amount%",
      recipientVariables: {
        "a@example.com": { name: "A. $& (Ada)", amount: "$100.50" },
      },
    });

    const sent = provider.raw.sent[0]?.message;
    expect(sent?.subject).toBe("Hi A. $& (Ada)");
    expect(sent?.html).toBe("<p>A. $& (Ada) owes $100.50</p>");
    expect(sent?.text).toBe("A. $& (Ada) owes $100.50");
  });

  test("leaves unknown %recipient% tokens intact", async () => {
    const provider = memoryProvider();
    const client = createEmailClient({ adapters: [provider] });

    await client.send({
      from: "hello@example.com",
      to: ["a@example.com"],
      subject: "Hi %recipient.name% %recipient.missing%",
      text: "x",
      recipientVariables: { "a@example.com": { name: "Ada" } },
    });

    expect(provider.raw.sent[0]?.message.subject).toBe("Hi Ada %recipient.missing%");
  });

  test("derives a per-recipient idempotency key in the fallback", async () => {
    const { provider, calls } = recordingProvider("rec");
    const client = createEmailClient({ adapters: [provider] });

    await client.send({ ...batchMessage, idempotencyKey: "batch-1" });

    expect(calls.map((call) => call.context.idempotencyKey)).toEqual([
      "batch-1:a@example.com",
      "batch-1:b@example.com",
    ]);
  });

  test("falls back to the next adapter when every recipient fails", async () => {
    const client = createEmailClient({
      adapters: [failingProvider("primary"), memoryProvider("backup")],
      fallback: ["backup"],
    });

    const response = await client.send(batchMessage);

    expect(response.provider).toBe("backup");
    expect(response.accepted).toEqual(["a@example.com", "b@example.com"]);
  });

  test("expanded per-recipient sends inherit sendAt", async () => {
    const sendAt = new Date("2026-07-10T12:30:00.000Z");
    const provider = memoryProvider();
    const client = createEmailClient({ adapters: [provider] });

    await client.send({ ...batchMessage, sendAt });

    expect(provider.raw.sent).toHaveLength(2);
    for (const sent of provider.raw.sent) {
      expect(sent.message.sendAt).toBe(sendAt);
    }
  });

  test("sendAt with recipientVariables on an adapter without scheduling rejects every expanded send", async () => {
    let requests = 0;
    const adapter = postmark({
      serverToken: "server",
      fetch: () => {
        requests += 1;
        throw new Error("unreachable — postmark must reject sendAt before any request");
      },
    });
    const client = createEmailClient({ adapters: [adapter] });

    const error = await client
      .send({ ...batchMessage, sendAt: new Date("2026-07-10T12:30:00.000Z") })
      .then(() => {
        throw new Error("send should have failed");
      })
      .catch((caught: unknown) => caught);

    // Every expanded per-recipient send runs the adapter's field assertion, so the
    // whole batch fails fast instead of delivering unscheduled mail.
    expect(error).toBeInstanceOf(EmailSdkError);
    expect((error as EmailSdkError).code).toBe("all_recipients_failed");
    const failures = (error as EmailSdkError).details as EmailProviderError[];
    expect(failures).toHaveLength(2);
    for (const failure of failures) {
      expect(failure.message).toBe("postmark does not support these EmailMessage fields: sendAt.");
    }
    expect(requests).toBe(0);
  });

  test("rejects recipientVariables combined with cc", async () => {
    const client = createEmailClient({ adapters: [memoryProvider()] });

    await expect(client.send({ ...batchMessage, cc: "cc@example.com" })).rejects.toBeInstanceOf(
      EmailValidationError,
    );
  });

  test("rejects recipientVariables for addresses not in to", async () => {
    const client = createEmailClient({ adapters: [memoryProvider()] });

    await expect(
      client.send({
        ...batchMessage,
        recipientVariables: { "stranger@example.com": { name: "X" } },
      }),
    ).rejects.toBeInstanceOf(EmailValidationError);
  });

  test("rejects variable keys outside letters, numbers, underscores, and hyphens", async () => {
    const client = createEmailClient({ adapters: [memoryProvider()] });

    // Dotted keys personalize on native provider routes but stay literal in the
    // client-side fallback regex, so they must fail fast on every route.
    await expect(
      client.send({
        from: "hello@example.com",
        to: ["a@example.com"],
        subject: "Hi %recipient.user.name%",
        text: "x",
        recipientVariables: { "a@example.com": { "user.name": "Ada" } },
      }),
    ).rejects.toThrow(
      'recipientVariables keys may only contain letters, numbers, underscores, and hyphens, but "a@example.com" has "user.name".',
    );
  });

  test("accepts variable keys with underscores and hyphens", async () => {
    const provider = memoryProvider();
    const client = createEmailClient({ adapters: [provider] });

    await client.send({
      from: "hello@example.com",
      to: ["a@example.com"],
      subject: "Hi %recipient.first_name% %recipient.last-name%",
      text: "x",
      recipientVariables: { "a@example.com": { first_name: "Ada", "last-name": "Lovelace" } },
    });

    expect(provider.raw.sent[0]?.message.subject).toBe("Hi Ada Lovelace");
  });

  test("treats empty recipientVariables as a normal send", async () => {
    const { provider, calls } = recordingProvider("native", { bulk: true });
    const client = createEmailClient({ adapters: [provider] });

    await client.send({
      from: "hello@example.com",
      to: ["a@example.com", "b@example.com"],
      subject: "Hi",
      text: "x",
      recipientVariables: {},
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe("send");
  });

  test("rejects duplicate to addresses with recipientVariables", async () => {
    const client = createEmailClient({ adapters: [memoryProvider()] });

    await expect(
      client.send({
        from: "hello@example.com",
        to: ["a@example.com", "a@example.com"],
        subject: "Hi",
        text: "x",
        recipientVariables: { "a@example.com": { name: "Ada" } },
      }),
    ).rejects.toBeInstanceOf(EmailValidationError);
  });

  test("fires onError per rejected recipient and reports partial results in the fallback", async () => {
    const errored: string[] = [];
    const provider: EmailProvider = {
      name: "partial",
      send(outgoing) {
        if (outgoing.to === "b@example.com") {
          throw new EmailProviderError("rejected", { provider: "partial", retryable: false });
        }

        return { provider: "partial", id: "ok" };
      },
    };
    const client = createEmailClient({
      adapters: [provider],
      hooks: {
        onError(event) {
          errored.push(String(event.message.to));
        },
      },
    });

    const response = await client.send(batchMessage);

    expect(response.accepted).toEqual(["a@example.com"]);
    expect(response.rejected).toEqual(["b@example.com"]);
    expect(errored).toEqual(["b@example.com"]);
  });
});

type RecordedCall = {
  kind: "send" | "sendBulk";
  message: EmailMessage;
  context: EmailProviderContext;
};

function recordingProvider(name: string, options: { bulk?: boolean } = {}) {
  const calls: RecordedCall[] = [];
  const provider: EmailProvider = {
    name,
    send(message, context) {
      calls.push({ kind: "send", message, context });
      return { provider: name, id: `${name}_${calls.length}` };
    },
  };

  if (options.bulk) {
    provider.sendBulk = (message, context) => {
      calls.push({ kind: "sendBulk", message, context });
      return { provider: name, id: `${name}_bulk` };
    };
  }

  return { provider, calls };
}

type CapturedEvent = { event: TelemetryEventName; properties?: TelemetryProperties };
type CapturedException = { error: unknown; context: CaptureExceptionContext };

function stubTelemetry() {
  const events: CapturedEvent[] = [];
  const exceptions: CapturedException[] = [];
  const telemetry: Telemetry = {
    enabled: true,
    capture(event, properties) {
      events.push({ event, properties });
      return Promise.resolve();
    },
    captureException(error, context) {
      exceptions.push({ error, context });
      return Promise.resolve();
    },
    flush: () => Promise.resolve(),
  };

  return { events, exceptions, telemetry };
}

function withTelemetry<T>(telemetry: Telemetry, run: () => Promise<T>) {
  setSharedTelemetry(telemetry);

  return run().finally(() => resetTelemetry());
}

describe("createEmailClient telemetry", () => {
  test("tags events with their source", async () => {
    const { events, telemetry } = stubTelemetry();

    await withTelemetry(telemetry, async () => {
      await createEmailClient({ adapters: [memoryProvider()] }).send(message);
      setTelemetrySource("cli");

      try {
        await createEmailClient({ adapters: [memoryProvider()] }).send(message);
      } finally {
        setTelemetrySource("sdk");
      }
    });

    const created = events.filter((item) => item.event === "client created");
    const sent = events.filter((item) => item.event === "email sent");
    expect(created.map((item) => item.properties?.source)).toEqual(["sdk", "cli"]);
    expect(sent.map((item) => item.properties?.source)).toEqual(["sdk", "cli"]);
    expect(sent[0]?.properties).toMatchObject({
      success: true,
      recipients: 1,
      delivery_path: "single",
      used_recipient_variables: false,
      used_send_at: false,
    });
  });

  test("reports failed sends as handled exceptions", async () => {
    const { events, exceptions, telemetry } = stubTelemetry();

    await withTelemetry(telemetry, async () => {
      const client = createEmailClient({ adapters: [failingProvider()] });
      await expect(client.send(message)).rejects.toBeInstanceOf(EmailProviderError);
    });

    const sent = events.filter((item) => item.event === "email sent");
    expect(sent[0]?.properties).toMatchObject({ success: false, error_code: "provider_error" });
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]?.context).toMatchObject({
      source: "sdk",
      handled: true,
      adapter: "custom",
    });
    expect(exceptions[0]?.error).toBeInstanceOf(EmailProviderError);
  });

  test("does not report usage errors as exceptions", async () => {
    const { events, exceptions, telemetry } = stubTelemetry();

    await withTelemetry(telemetry, async () => {
      const client = createEmailClient({ adapters: [memoryProvider()] });
      await expect(client.send(message, { adapter: "missing" })).rejects.toThrow(
        'Email provider "missing" is not registered.',
      );
    });

    expect(events.filter((item) => item.event === "email sent")).toHaveLength(1);
    expect(exceptions).toHaveLength(0);
  });

  test("marks scheduled sends", async () => {
    const { events, telemetry } = stubTelemetry();

    await withTelemetry(telemetry, async () => {
      const client = createEmailClient({ adapters: [memoryProvider("resend")] });
      await client.send({ ...message, sendAt: new Date("2026-07-10T12:30:00Z") });
    });

    const sent = events.filter((item) => item.event === "email sent");
    expect(sent[0]?.properties).toMatchObject({ used_send_at: true, delivery_path: "single" });
  });

  test("counts one bulk_native send for recipientVariables on a native adapter", async () => {
    const { events, telemetry } = stubTelemetry();
    const { provider, calls } = recordingProvider("native", { bulk: true });

    await withTelemetry(telemetry, async () => {
      await createEmailClient({ adapters: [provider] }).send(batchMessage);
    });

    expect(calls.map((call) => call.kind)).toEqual(["sendBulk"]);
    const sent = events.filter((item) => item.event === "email sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.properties).toMatchObject({
      success: true,
      recipients: 2,
      delivery_path: "bulk_native",
      used_recipient_variables: true,
      adapter: "custom",
    });
  });

  test("counts one bulk_expanded send even when the client expands per recipient", async () => {
    const { events, telemetry } = stubTelemetry();
    const provider = memoryProvider();

    await withTelemetry(telemetry, async () => {
      await createEmailClient({ adapters: [provider] }).send(batchMessage);
    });

    // Two provider-level sends, one user-facing send() call, one event.
    expect(provider.raw.sent).toHaveLength(2);
    const sent = events.filter((item) => item.event === "email sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.properties).toMatchObject({
      success: true,
      recipients: 2,
      delivery_path: "bulk_expanded",
      used_recipient_variables: true,
    });
  });

  test("derives the failed delivery path from the primary adapter", async () => {
    const { events, telemetry } = stubTelemetry();

    await withTelemetry(telemetry, async () => {
      const client = createEmailClient({ adapters: [failingProvider()] });
      // Every expanded recipient fails, so the client aggregates the failures.
      await expect(client.send(batchMessage)).rejects.toBeInstanceOf(EmailSdkError);
    });

    const sent = events.filter((item) => item.event === "email sent");
    expect(sent[0]?.properties).toMatchObject({
      success: false,
      error_code: "all_recipients_failed",
      delivery_path: "bulk_expanded",
      used_recipient_variables: true,
    });
  });

  test("summarizes sendBatch runs", async () => {
    const { events, telemetry } = stubTelemetry();

    await withTelemetry(telemetry, async () => {
      const client = createEmailClient({ adapters: [memoryProvider()] });
      await client.sendBatch([
        { ...message, cc: "copy@example.com" },
        { ...message, adapter: "missing" },
      ]);
    });

    const batch = events.filter((item) => item.event === "email batch sent");
    expect(batch).toHaveLength(1);
    expect(batch[0]?.properties).toMatchObject({
      message_count: 2,
      succeeded: 1,
      failed: 1,
      recipients: 3,
      success: false,
      error_code: "provider_not_found",
      source: "sdk",
      // Both items normalize to the same adapter, so the summary is uniform.
      adapter: "custom",
    });
    // Per-item events still fire through send().
    expect(events.filter((item) => item.event === "email sent")).toHaveLength(2);
  });

  test("reports a mixed adapter when batch items differ", async () => {
    const { events, telemetry } = stubTelemetry();

    await withTelemetry(telemetry, async () => {
      const client = createEmailClient({
        adapters: [memoryProvider("resend"), memoryProvider("smtp")],
        defaultAdapter: "resend",
      });
      await client.sendBatch([
        { ...message, adapter: "resend" },
        { ...message, adapter: "smtp" },
      ]);
    });

    const batch = events.filter((item) => item.event === "email batch sent");
    expect(batch[0]?.properties).toMatchObject({ adapter: "mixed", message_count: 2 });
  });

  test("batch adapter reflects the adapter that actually delivered", async () => {
    const { events, telemetry } = stubTelemetry();

    await withTelemetry(telemetry, async () => {
      const client = createEmailClient({
        adapters: [failingProvider("resend"), memoryProvider("smtp")],
      });
      await client.sendBatch([{ ...message, adapter: "resend", fallbackAdapters: ["smtp"] }]);
    });

    const batch = events.filter((item) => item.event === "email batch sent");
    // Primary "resend" failed and "smtp" delivered, so the summary names smtp.
    expect(batch[0]?.properties).toMatchObject({ adapter: "smtp", succeeded: 1, failed: 0 });
  });

  test("createEmailClient({ telemetry: false }) disables client events", async () => {
    const { events, exceptions, telemetry } = stubTelemetry();

    await withTelemetry(telemetry, async () => {
      const client = createEmailClient({ adapters: [memoryProvider()], telemetry: false });
      await client.send(message);
      await client.sendBatch([message]);
    });

    expect(events).toHaveLength(0);
    expect(exceptions).toHaveLength(0);
  });
});
