import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmailClient } from "./core.js";
import { resend } from "./resend.js";
import { failingAdapter, memoryAdapter } from "./testing.js";
import { EmailAdapterError } from "./errors.js";
import { createTelemetry, resetTelemetry, setSharedTelemetry } from "./telemetry.js";
import { adapter, message, telemetryCapture } from "../test-support/core-fixtures.js";
import { stubFetch } from "../test-support/fetch.js";

describe("createEmailClient v1", () => {
  test("empty and mixed-outcome batches are summaries without volume counters", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const client = createEmailClient({
        adapters: [adapter("resend", () => ({ adapter: "resend", accepted: ["a@example.com"] }))],
      });

      await client.sendMany([]);
      await client.sendMany([{ message }, { message: { ...message, to: [] } }]);
      const batches = capture.events.filter((item) => item.event === "email batch sent");
      expect(batches.map((item) => item.properties?.message_count)).toEqual([0, 2]);
      expect(batches[1]?.properties).toMatchObject({
        succeeded: 1,
        failed: 1,
        measurement_scope: "batch_summary",
      });

      for (const item of batches) {
        expect(item.properties).not.toHaveProperty("logical_operation_count");
        expect(item.properties).not.toHaveProperty("adapter_attempt_count");
        expect(item.properties).not.toHaveProperty("accepted_message_count");
      }

      expect(
        capture.events.reduce(
          (sum, item) => sum + Number(item.properties?.accepted_message_count ?? 0),
          0,
        ),
      ).toBe(1);
    } finally {
      resetTelemetry();
    }
  });

  test.each([false, true])(
    "partial provider errors preserve valid aggregate acceptance (native=%s)",
    async (native) => {
      const capture = telemetryCapture();
      setSharedTelemetry(capture.telemetry);

      try {
        const fail = () => {
          throw new EmailAdapterError("partial", {
            adapter: "lettr",
            delivery: "unknown",
            acceptedCount: 2,
            rejectedCount: 1,
            requestId: "private-request-id",
          });
        };

        const client = createEmailClient({
          adapters: [adapter("lettr", fail, native ? { sendPersonalized: fail } : {})],
        });

        const recipients = ["a@example.com", "b@example.com", "c@example.com"];
        await expect(
          native
            ? client.sendPersonalized({
                message,
                recipients: recipients.map((to) => ({ to, variables: {} })),
              })
            : client.send({ ...message, to: recipients }),
        ).rejects.toBeDefined();
        const attempt = capture.events.find((item) => item.event === "email adapter attempted");
        expect(attempt?.properties).toMatchObject({
          accepted_message_count: native ? 2 : 1,
          accepted_recipient_count: 2,
          rejected_recipient_count: 1,
          unknown_recipient_count: 0,
          adapter_failure_count: 1,
          uncertain_attempt_count: 1,
        });
        expect(JSON.stringify(attempt)).not.toContain("private-request-id");
      } finally {
        resetTelemetry();
      }
    },
  );

  test.each([
    [2, 2],
    [1, 0],
    [-1, 4],
    [NaN, 3],
    [0.5, 2.5],
  ])("invalid provider counts %s/%s remain unknown", async (acceptedCount, rejectedCount) => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const client = createEmailClient({
        adapters: [
          adapter("lettr", () => {
            throw new EmailAdapterError("inconsistent", {
              adapter: "lettr",
              delivery: "unknown",
              acceptedCount,
              rejectedCount,
            });
          }),
        ],
      });

      await expect(
        client.send({ ...message, to: ["a@example.com", "b@example.com", "c@example.com"] }),
      ).rejects.toBeDefined();
      expect(
        capture.events.find((item) => item.event === "email adapter attempted")?.properties,
      ).toMatchObject({
        accepted_recipient_count: 0,
        rejected_recipient_count: 0,
        unknown_recipient_count: 3,
      });
    } finally {
      resetTelemetry();
    }
  });

  test("runtime provider volume excludes memory but includes anonymized custom adapters", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry({ ...capture.telemetry, realProviderVolume: true });

    try {
      for (const name of ["resend", "memory", "private-adapter"]) {
        await createEmailClient({
          adapters: [adapter(name, () => ({ adapter: name, accepted: ["a@example.com"] }))],
        }).send(message);
      }

      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts.map((item) => item.properties?.provider_attempt_count)).toEqual([1, 0, 1]);
      expect(attempts.map((item) => item.properties?.provider_accepted_message_count)).toEqual([
        1, 0, 1,
      ]);
      expect(attempts.map((item) => item.properties?.provider_accepted_recipient_count)).toEqual([
        1, 0, 1,
      ]);
      expect(attempts[2]?.properties).toMatchObject({
        adapter: "custom",
        adapter_kind: "custom",
        provider_volume_eligible: true,
      });
      expect(JSON.stringify(attempts)).not.toContain("private-adapter");
    } finally {
      resetTelemetry();
    }
  });

  test("renamed provider routes retain volume without exposing their names", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry({ ...capture.telemetry, realProviderVolume: true });

    try {
      const backup = {
        ...resend({
          apiKey: "test-key",
          fetch: stubFetch(async () => Response.json({ id: "private-receipt" })),
        }),
        name: "private-backup-route",
      };

      const primary = adapter("resend", () => {
        throw new EmailAdapterError("unavailable", { adapter: "resend", delivery: "not_sent" });
      });

      await createEmailClient({
        adapters: [primary, backup],
        fallback: { adapters: [backup.name] },
      }).send(message);
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts.map((item) => item.properties?.provider_attempt_count)).toEqual([1, 1]);
      expect(attempts.map((item) => item.properties?.provider_submitted_message_count)).toEqual([
        0, 1,
      ]);
      expect(attempts[1]?.properties).toMatchObject({
        adapter: "custom",
        adapter_kind: "custom",
        provider_volume_eligible: true,
        acceptance_basis: "inferred_from_success",
      });
      expect(JSON.stringify(capture.events)).not.toContain("private-backup-route");
      expect(JSON.stringify(capture.events)).not.toContain("private-receipt");
    } finally {
      resetTelemetry();
    }
  });

  test("real Resend ID-only results count submissions without inventing explicit acceptance", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry({ ...capture.telemetry, realProviderVolume: true });
    let requests = 0;

    try {
      const client = createEmailClient({
        adapters: [
          resend({
            apiKey: "test-key",
            fetch: stubFetch(async () => {
              requests++;

              return Response.json({ id: "private-message-id" });
            }),
          }),
        ],
      });

      await client.send({
        ...message,
        to: ["a@example.com", "b@example.com"],
        cc: "c@example.com",
        bcc: "d@example.com",
      });
      await client.sendPersonalized({
        message,
        recipients: [
          { to: "a@example.com", variables: {} },
          { to: "b@example.com", variables: {} },
        ],
      });
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(requests).toBe(3);
      expect(attempts.map((item) => item.properties?.provider_submitted_message_count)).toEqual([
        1, 1, 1,
      ]);
      expect(attempts.map((item) => item.properties?.provider_submitted_recipient_count)).toEqual([
        4, 1, 1,
      ]);

      for (const item of attempts)
        expect(item.properties).toMatchObject({
          adapter_kind: "provider",
          provider_volume_eligible: true,
          acceptance_basis: "inferred_from_success",
          accepted_message_count: 0,
          accepted_recipient_count: 0,
          provider_accepted_message_count: 0,
          provider_accepted_recipient_count: 0,
        });
      expect(JSON.stringify(attempts)).not.toContain("private-message-id");
      expect(JSON.stringify(attempts)).not.toContain("@example.com");
    } finally {
      resetTelemetry();
    }
  });

  test("test-adapter markers survive built-in names, spread, renaming, and native extensions", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry({ ...capture.telemetry, realProviderVolume: true });

    try {
      for (const testAdapter of [
        memoryAdapter("resend"),
        failingAdapter("resend"),
        { ...memoryAdapter("private"), name: "resend" },
        { ...failingAdapter("private"), name: "resend" },
      ]) {
        await createEmailClient({ adapters: [testAdapter] }).sendMany([{ message }]);

        const extended = {
          ...testAdapter,
          sendPersonalized: () => ({
            adapter: "resend",
            accepted: ["a@example.com"],
            rejected: [],
          }),
        };

        await createEmailClient({ adapters: [extended] }).sendPersonalized({
          message,
          recipients: [{ to: "a@example.com", variables: {} }],
        });
      }

      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts).toHaveLength(8);

      for (const item of attempts)
        expect(item.properties).toMatchObject({
          adapter: "resend",
          adapter_kind: "test",
          provider_volume_eligible: false,
          provider_attempt_count: 0,
          provider_accepted_message_count: 0,
          provider_accepted_recipient_count: 0,
          provider_submitted_message_count: 0,
          provider_submitted_recipient_count: 0,
        });
    } finally {
      resetTelemetry();
    }
  });

  test("explicit empty or rejected results never infer recipient submissions", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry({ ...capture.telemetry, realProviderVolume: true });

    try {
      for (const result of [
        { adapter: "resend", accepted: [] },
        { adapter: "resend", rejected: ["a@example.com", "b@example.com"] },
        { adapter: "resend", accepted: [], rejected: ["a@example.com", "b@example.com"] },
        { adapter: "resend", accepted: ["a@example.com"], rejected: ["b@example.com"] },
      ]) {
        await createEmailClient({ adapters: [adapter("resend", () => result)] }).send({
          ...message,
          to: ["a@example.com", "b@example.com"],
        });
      }

      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts.map((item) => item.properties?.provider_submitted_message_count)).toEqual([
        0, 0, 0, 1,
      ]);
      expect(attempts.map((item) => item.properties?.provider_submitted_recipient_count)).toEqual([
        0, 0, 0, 1,
      ]);
      expect(attempts.map((item) => item.properties?.acceptance_basis)).toEqual([
        "explicit",
        "explicit",
        "explicit",
        "explicit",
      ]);
    } finally {
      resetTelemetry();
    }
  });

  test("partial typed errors retain submissions while unknown failures do not infer them", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry({ ...capture.telemetry, realProviderVolume: true });

    try {
      for (const counts of [
        { acceptedCount: 1, rejectedCount: 1 },
        {},
        { acceptedCount: 4, rejectedCount: 0 },
      ]) {
        await createEmailClient({
          adapters: [
            adapter("lettr", () => {
              throw new EmailAdapterError("partial", {
                adapter: "lettr",
                delivery: "unknown",
                ...counts,
              });
            }),
          ],
        }).sendMany([{ message: { ...message, to: ["a@example.com", "b@example.com"] } }]);
      }

      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts.map((item) => item.properties?.provider_submitted_recipient_count)).toEqual([
        1, 0, 0,
      ]);
      expect(attempts.map((item) => item.properties?.provider_accepted_recipient_count)).toEqual([
        1, 0, 0,
      ]);
      expect(attempts.map((item) => item.properties?.acceptance_basis)).toEqual([
        "explicit",
        "unknown",
        "unknown",
      ]);
    } finally {
      resetTelemetry();
    }
  });

  test("client.flush() waits for the telemetry request to actually land", async () => {
    let releaseResponse: (() => void) | undefined;

    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });

    const delivered: string[] = [];

    const fetchFn = stubFetch(async (_url: URL | RequestInfo, init?: RequestInit) => {
      await responseGate;
      delivered.push(JSON.parse(String(init?.body)).event);

      return new Response("{}", { status: 200 });
    });

    setSharedTelemetry(
      createTelemetry({
        env: {},
        fetch: fetchFn,
        configDir: join(mkdtempSync(join(tmpdir(), "email-sdk-flush-")), "email-sdk"),
        notify: () => {},
      }),
    );

    try {
      const client = createEmailClient({ adapters: [adapter("resend")] });
      await client.send(message);

      // send() resolves while the POST is still open — on serverless the runtime
      // freezes here and the event is lost. flush() is what closes that window.
      expect(delivered).toHaveLength(0);

      releaseResponse?.();
      await client.flush();
      expect(delivered).toContain("email sent");
    } finally {
      resetTelemetry();
    }
  });

  test("client.flush() resolves when telemetry is disabled", async () => {
    const client = createEmailClient({ adapters: [adapter("resend")], telemetry: false });
    await expect(client.flush()).resolves.toBeUndefined();
  });
});
