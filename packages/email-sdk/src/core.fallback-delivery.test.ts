import { describe, expect, test } from "bun:test";
import { createEmailClient } from "./core.js";
import { EmailAllRecipientsFailedError, EmailRouteError } from "./errors.js";
import { resend } from "./resend.js";
import { sendgrid } from "./sendgrid.js";
import { memoryAdapter } from "./testing.js";
import type { EmailAdapter } from "./types.js";
import { message } from "../test-support/core-fixtures.js";
import { rejectionOf } from "../test-support/assertions.js";
import { stubFetch } from "../test-support/fetch.js";

type Outcome = { status: number } | { error: Error };

// Each call to the primary consumes the next scripted outcome; the last one repeats.
function scriptedFetch(outcomes: readonly Outcome[]) {
  let calls = 0;

  const fetch = stubFetch(async () => {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls += 1;

    if (!outcome) throw new Error("No scripted outcome.");

    if ("error" in outcome) throw outcome.error;

    return new Response(JSON.stringify({ message: "provider said no" }), {
      status: outcome.status,
      headers: { "content-type": "application/json" },
    });
  });

  return { fetch, calls: () => calls };
}

// Resend builds its own HTTP error; SendGrid goes through the shared jsonProvider.
const PRIMARIES = {
  resend: (fetch) => resend({ apiKey: "re_test", fetch }),
  sendgrid: (fetch) => sendgrid({ apiKey: "SG.test", fetch }),
} satisfies Record<string, (fetch: typeof fetch) => EmailAdapter>;

function clientFor(primary: EmailAdapter, retry?: { maxAttempts: number }) {
  const backup = memoryAdapter("backup");

  const client = createEmailClient({
    adapters: [primary, backup],
    fallback: { adapters: ["backup"] },
    retry: retry && { ...retry, delay: () => 0, shouldRetry: () => true },
  });

  return { client, backup };
}

describe("default fallback policy with real HTTP adapters", () => {
  for (const [name, create] of Object.entries(PRIMARIES)) {
    for (const status of [401, 422]) {
      test(`${name} ${status} falls back to the next adapter`, async () => {
        const primary = scriptedFetch([{ status }]);
        const { client, backup } = clientFor(create(primary.fetch));

        await expect(client.send(message)).resolves.toMatchObject({ adapter: "backup" });
        expect(primary.calls()).toBe(1);
        expect(backup.raw.sent).toHaveLength(1);
      });
    }

    for (const status of [408, 429, 500, 503]) {
      test(`${name} ${status} stops without trying the next adapter`, async () => {
        const primary = scriptedFetch([{ status }]);
        const { client, backup } = clientFor(create(primary.fetch));

        const error = await rejectionOf(client.send(message), EmailRouteError);
        expect(error.failures).toHaveLength(1);
        expect(error.failures[0]).toMatchObject({ adapter: name, status, delivery: "unknown" });
        expect(backup.raw.sent).toHaveLength(0);
      });
    }

    const transportFailures = {
      timeout: new DOMException("The operation timed out.", "TimeoutError"),
      "network error": new TypeError("fetch failed"),
    } satisfies Record<string, Error>;

    for (const [kind, failure] of Object.entries(transportFailures)) {
      test(`${name} ${kind} stops without trying the next adapter`, async () => {
        const primary = scriptedFetch([{ error: failure }]);
        const { client, backup } = clientFor(create(primary.fetch));

        const error = await rejectionOf(client.send(message), EmailRouteError);
        expect(error.failures[0]).toMatchObject({ adapter: name, delivery: "unknown" });
        expect(backup.raw.sent).toHaveLength(0);
      });
    }

    test(`${name} retry ending in 422 after an ambiguous 503 still stops`, async () => {
      const primary = scriptedFetch([{ status: 503 }, { status: 422 }]);
      const { client, backup } = clientFor(create(primary.fetch), { maxAttempts: 2 });

      const error = await rejectionOf(client.send(message), EmailRouteError);
      expect(primary.calls()).toBe(2);
      expect(error.failures[0]).toMatchObject({ adapter: name, status: 422, delivery: "unknown" });
      expect(backup.raw.sent).toHaveLength(0);
    });

    test(`${name} retry ending in 422 after a definite 401 falls back`, async () => {
      const primary = scriptedFetch([{ status: 401 }, { status: 422 }]);
      const { client, backup } = clientFor(create(primary.fetch), { maxAttempts: 2 });

      await expect(client.send(message)).resolves.toMatchObject({ adapter: "backup" });
      expect(primary.calls()).toBe(2);
      expect(backup.raw.sent).toHaveLength(1);
    });
  }

  const personalizedInput = {
    message: { from: "hello@example.com", subject: "Hi %recipient.name%", text: "Hello" },
    recipients: [
      { to: "a@example.com", variables: { name: "A" } },
      { to: "b@example.com", variables: { name: "B" } },
    ],
  };

  test("native personalized 422 falls back to the next adapter", async () => {
    const primary = scriptedFetch([{ status: 422 }]);
    const { client, backup } = clientFor(PRIMARIES.sendgrid(primary.fetch));

    await expect(client.sendPersonalized(personalizedInput)).resolves.toMatchObject({
      adapter: "backup",
    });
    expect(backup.raw.sent).toHaveLength(2);
  });

  test("native personalized retry ending in 422 after an ambiguous 503 still stops", async () => {
    const primary = scriptedFetch([{ status: 503 }, { status: 422 }]);
    const { client, backup } = clientFor(PRIMARIES.sendgrid(primary.fetch), { maxAttempts: 2 });

    const error = await rejectionOf(
      client.sendPersonalized(personalizedInput),
      EmailAllRecipientsFailedError,
    );

    expect(primary.calls()).toBe(2);
    expect(error.failures[0]).toMatchObject({ status: 422, delivery: "unknown" });
    expect(backup.raw.sent).toHaveLength(0);
  });
});
