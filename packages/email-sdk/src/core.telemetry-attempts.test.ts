import { describe, expect, test } from "bun:test";
import { createEmailClient } from "./core.js";
import {
  EmailAbortError,
  EmailAdapterError,
  EmailAllRecipientsFailedError,
  EmailMiddlewareError,
} from "./errors.js";
import { resetTelemetry, setSharedTelemetry } from "./telemetry.js";
import {
  adapter,
  capabilities,
  emailAddressOfTest,
  message,
  telemetryCapture,
} from "../test-support/core-fixtures.js";

describe("createEmailClient v1", () => {
  test("sendPersonalized emits safe telemetry for native and expanded delivery", async () => {
    const nativeCapture = telemetryCapture();
    setSharedTelemetry(nativeCapture.telemetry);

    try {
      const nativeClient = createEmailClient({
        adapters: [
          adapter("sendgrid", undefined, {
            capabilities: { ...capabilities, personalized: "native" },
            sendPersonalized() {
              return {
                adapter: "sendgrid",
                accepted: ["ada@example.com", "linus@example.com"],
                rejected: ["bad@example.com"],
              };
            },
          }),
        ],
      });

      await nativeClient.sendPersonalized({
        message: {
          from: message.from,
          subject: "Hi %recipient.name%",
          text: "Hello %recipient.name%",
        },
        recipients: [
          { to: "ada@example.com", variables: { name: "Ada" } },
          { to: "linus@example.com", variables: { name: "Linus" } },
          { to: "bad@example.com", variables: { name: "Bad" } },
        ],
      });

      const nativeEvent = nativeCapture.events.findLast((item) => item.event === "email sent");
      expect(nativeEvent?.properties).toMatchObject({
        adapter: "sendgrid",
        delivery_path: "personalized_native",
        success: true,
        recipients: 3,
        personalized_recipient_count: 3,
        used_recipient_variables: true,
        logical_operation_count: 1,
        source: "sdk",
      });
      expect(JSON.stringify(nativeEvent?.properties)).not.toContain("Ada");
      expect(JSON.stringify(nativeEvent?.properties)).not.toContain("ada@example.com");
      expect(
        nativeCapture.events.find((item) => item.event === "email adapter attempted")?.properties,
      ).toMatchObject({
        accepted_message_count: 2,
        accepted_recipient_count: 2,
        rejected_recipient_count: 1,
        unknown_recipient_count: 0,
        adapter_attempt_count: 1,
      });
      expect(nativeCapture.exceptions).toHaveLength(0);
    } finally {
      resetTelemetry();
    }

    const expandedCapture = telemetryCapture();
    setSharedTelemetry(expandedCapture.telemetry);

    try {
      const expandedClient = createEmailClient({
        adapters: [
          adapter("resend", (value) => {
            if (value.to === "bad@example.com") {
              throw new EmailAdapterError("bad", {
                adapter: "resend",
                delivery: "not_sent",
              });
            }

            return { adapter: "resend", id: "ok" };
          }),
        ],
      });

      await expandedClient.sendPersonalized({
        message: { from: message.from, subject: "Hi", text: "Hello" },
        recipients: [
          { to: "good@example.com", variables: {} },
          { to: "bad@example.com", variables: {} },
        ],
      });

      const expandedEvent = expandedCapture.events.findLast((item) => item.event === "email sent");
      expect(expandedEvent?.properties).toMatchObject({
        adapter: "resend",
        delivery_path: "personalized_expanded",
        success: true,
        recipients: 2,
        logical_operation_count: 1,
      });
      expect(expandedCapture.exceptions).toHaveLength(0);
    } finally {
      resetTelemetry();
    }
  });

  test("logical operations never infer acceptance from successful results", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const client = createEmailClient({
        adapters: [
          adapter("resend", (value) => {
            if (value.to === "bad@example.com") {
              throw new EmailAdapterError("bad", { adapter: "resend", delivery: "not_sent" });
            }

            return { adapter: "resend", id: "ok" };
          }),
        ],
      });

      // One message shared by three addresses is one email, not three.
      await client.send({
        ...message,
        to: ["a@example.com", "b@example.com"],
        cc: "c@example.com",
      });

      // Personalized fans out to one message per recipient; one fails.
      await client.sendPersonalized({
        message: { from: message.from, subject: "Hi", text: "Hello" },
        recipients: [
          { to: "good@example.com", variables: {} },
          { to: "bad@example.com", variables: {} },
        ],
      });

      await expect(client.send({ ...message, to: "bad@example.com" })).rejects.toBeDefined();

      const sends = capture.events.filter((item) => item.event === "email sent");
      expect(sends.map((item) => item.properties?.message_count)).toEqual([1, 2, 1]);
      expect(sends.map((item) => item.properties?.logical_operation_count)).toEqual([1, 1, 1]);
      expect(sends.map((item) => item.properties?.operation_failure_count)).toEqual([0, 0, 1]);
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts).toHaveLength(4);
      expect(attempts.map((item) => item.properties?.accepted_recipient_count)).toEqual([
        0, 0, 0, 0,
      ]);
      expect(attempts.map((item) => item.properties?.unknown_recipient_count)).toEqual([
        3, 1, 0, 0,
      ]);

      for (const item of capture.events)
        expect(item.properties).not.toHaveProperty("delivered_count");
    } finally {
      resetTelemetry();
    }
  });

  test("sendMany counts every item once on 'email sent'", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const client = createEmailClient({ adapters: [adapter("resend")] });
      await client.sendMany([{ message }, { message }, { message }]);

      const operations = capture.events.reduce(
        (total, item) => total + Number(item.properties?.logical_operation_count ?? 0),
        0,
      );

      const attempts = capture.events.reduce(
        (total, item) => total + Number(item.properties?.adapter_attempt_count ?? 0),
        0,
      );

      const batch = capture.events.find((item) => item.event === "email batch sent");
      expect(operations).toBe(3);
      expect(attempts).toBe(3);
      expect(batch?.properties).toMatchObject({ message_count: 3, succeeded: 3 });
      expect(batch?.properties).not.toHaveProperty("delivered_count");
    } finally {
      resetTelemetry();
    }
  });

  test("attempt measurements separate retries, fallback, and partial acceptance", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      let calls = 0;

      const client = createEmailClient({
        adapters: [
          adapter("resend", () => {
            calls++;
            throw new EmailAdapterError("private provider detail", {
              adapter: "resend",
              retryable: true,
              delivery: calls === 1 ? "unknown" : "not_sent",
            });
          }),
          adapter("smtp", () => ({
            adapter: "smtp",
            accepted: ["a@example.com"],
            rejected: ["b@example.com"],
          })),
        ],
        retry: { maxAttempts: 2, delay: () => 0, shouldRetry: () => true },
        fallback: { adapters: ["smtp"] },
      });

      await client.send({ ...message, to: ["a@example.com", "b@example.com"] });
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts).toHaveLength(3);
      expect(attempts.map((item) => item.properties?.adapter)).toEqual([
        "resend",
        "resend",
        "smtp",
      ]);
      expect(attempts.map((item) => item.properties?.uncertain_attempt_count)).toEqual([1, 0, 0]);
      expect(attempts.map((item) => item.properties?.not_sent_attempt_count)).toEqual([0, 1, 0]);
      expect(attempts[2]?.properties).toMatchObject({
        accepted_message_count: 1,
        accepted_recipient_count: 1,
        rejected_recipient_count: 1,
      });
      expect(capture.events.filter((item) => item.event === "email sent")).toHaveLength(1);
      expect(JSON.stringify(attempts)).not.toContain("@example.com");
      expect(JSON.stringify(attempts)).not.toContain("private provider detail");
    } finally {
      resetTelemetry();
    }
  });

  test("validation, pre-abort, and before middleware failures never count attempts", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const client = createEmailClient({ adapters: [adapter("resend")] });
      await client.validate(message);
      expect(capture.events.filter((item) => item.event !== "client created")).toHaveLength(0);
      await expect(client.send({ ...message, to: [] })).rejects.toBeDefined();
      await expect(client.send(message, { signal: AbortSignal.abort() })).rejects.toBeDefined();

      const blocked = createEmailClient({
        adapters: [adapter("resend")],
        plugins: [
          {
            id: "block",
            middleware: [
              {
                beforeSend() {
                  throw new Error("blocked");
                },
              },
            ],
          },
        ],
      });

      await expect(blocked.send(message)).rejects.toBeDefined();
      expect(
        capture.events.filter((item) => item.event === "email adapter attempted"),
      ).toHaveLength(0);
      expect(capture.events.filter((item) => item.event === "email sent")).toHaveLength(3);
    } finally {
      resetTelemetry();
    }
  });

  test.each(["single", "native", "expanded"])(
    "%s retains acceptance before after-send middleware failure",
    async (path) => {
      const capture = telemetryCapture();
      setSharedTelemetry(capture.telemetry);

      try {
        const result = { adapter: "resend", accepted: ["a@example.com"], rejected: [] };

        const client = createEmailClient({
          adapters: [
            adapter(
              "resend",
              () => result,
              path === "native" ? { sendPersonalized: () => result } : {},
            ),
          ],
          plugins: [
            {
              id: "after",
              middleware: [
                {
                  afterSend() {
                    throw new Error("after failed");
                  },
                },
              ],
            },
          ],
        });

        const operation =
          path === "single"
            ? client.send(message)
            : client.sendPersonalized({
                message,
                recipients: [{ to: "a@example.com", variables: {} }],
              });

        await expect(operation).rejects.toBeInstanceOf(EmailMiddlewareError);
        expect(
          capture.events.find((item) => item.event === "email adapter attempted")?.properties,
        ).toMatchObject({
          accepted_message_count: 1,
          accepted_recipient_count: 1,
          adapter_failure_count: 0,
        });
        expect(
          capture.events.find((item) => item.event === "email sent")?.properties,
        ).toMatchObject({ operation_failure_count: 1 });
      } finally {
        resetTelemetry();
      }
    },
  );

  test("abort after adapter resolution preserves explicit acceptance", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const controller = new AbortController();

      const client = createEmailClient({
        adapters: [
          adapter("smtp", () => {
            controller.abort();

            return { adapter: "smtp", accepted: ["a@example.com"] };
          }),
        ],
      });

      await expect(client.send(message, { signal: controller.signal })).rejects.toBeInstanceOf(
        EmailAbortError,
      );
      expect(
        capture.events.find((item) => item.event === "email adapter attempted")?.properties,
      ).toMatchObject({
        accepted_recipient_count: 1,
        uncertain_attempt_count: 0,
        adapter_resolved_count: 1,
      });
    } finally {
      resetTelemetry();
    }
  });

  test("native errors and expanded unknown failures do not fabricate rejection", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const fail = () => {
        throw new EmailAdapterError("partial outcome", { adapter: "smtp", delivery: "unknown" });
      };

      const input = {
        message,
        recipients: [
          { to: "a@example.com", variables: {} },
          { to: "b@example.com", variables: {} },
        ],
      };

      for (const native of [true, false]) {
        const client = createEmailClient({
          adapters: [adapter("smtp", fail, native ? { sendPersonalized: fail } : {})],
        });

        await expect(client.sendPersonalized(input)).rejects.toBeInstanceOf(
          EmailAllRecipientsFailedError,
        );
      }

      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts.map((item) => item.properties?.unknown_recipient_count)).toEqual([2, 1, 1]);

      for (const item of attempts)
        expect(item.properties).toMatchObject({
          rejected_recipient_count: 0,
          accepted_recipient_count: 0,
          uncertain_attempt_count: 1,
        });
    } finally {
      resetTelemetry();
    }
  });

  test("attempt facts use middleware-prepared recipients and the actual adapter", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const client = createEmailClient({
        adapters: [adapter("resend"), adapter("smtp")],
        plugins: [
          {
            id: "reroute",
            middleware: [
              {
                beforeSend: () => ({
                  message: {
                    ...message,
                    to: ["a@example.com", "b@example.com"],
                    bcc: "c@example.com",
                  },
                  options: { adapter: "smtp" },
                }),
              },
            ],
          },
        ],
      });

      await client.send(message);
      expect(
        capture.events.find((item) => item.event === "email adapter attempted")?.properties,
      ).toMatchObject({ adapter: "smtp", attempted_recipient_count: 3 });
    } finally {
      resetTelemetry();
    }
  });

  test.each(["memory", "resend", "private-custom-name"])(
    "%s injected captures never contribute real provider volume",
    async (name) => {
      const capture = telemetryCapture();
      setSharedTelemetry(capture.telemetry);

      try {
        await createEmailClient({
          adapters: [adapter(name, () => ({ adapter: name, accepted: ["a@example.com"] }))],
        }).send(message);
        expect(
          capture.events.find((item) => item.event === "email adapter attempted")?.properties,
        ).toMatchObject({
          provider_volume_eligible: false,
          provider_attempt_count: 0,
          provider_accepted_message_count: 0,
          provider_accepted_recipient_count: 0,
          accepted_recipient_count: 1,
        });
        expect(JSON.stringify(capture.events)).not.toContain("private-custom-name");
      } finally {
        resetTelemetry();
      }
    },
  );

  test("native retry and fallback emit one observation per call, not per recipient", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      let calls = 0;

      const client = createEmailClient({
        adapters: [
          adapter("sendgrid", undefined, {
            sendPersonalized() {
              if (++calls === 1)
                throw new EmailAdapterError("retry", {
                  adapter: "sendgrid",
                  delivery: "not_sent",
                  retryable: true,
                });

              return {
                adapter: "sendgrid",
                accepted: [],
                rejected: ["a@example.com", "b@example.com"],
              };
            },
          }),
          adapter("resend", (value) => ({
            adapter: "resend",
            accepted: [emailAddressOfTest(value.to)],
          })),
        ],
        retry: { maxAttempts: 2, delay: () => 0 },
        fallback: { adapters: ["resend"] },
      });

      await client.sendPersonalized({
        message,
        recipients: [
          { to: "a@example.com", variables: {} },
          { to: "b@example.com", variables: {} },
        ],
      });
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts).toHaveLength(4);
      expect(attempts.map((item) => item.properties?.accepted_message_count)).toEqual([0, 0, 1, 1]);
      expect(attempts.map((item) => item.properties?.rejected_recipient_count)).toEqual([
        0, 2, 0, 0,
      ]);
      expect(attempts.map((item) => item.properties?.adapter_failure_count)).toEqual([1, 0, 0, 0]);
      expect(capture.events.filter((item) => item.event === "email sent")).toHaveLength(1);
    } finally {
      resetTelemetry();
    }
  });

  test("expanded resolved rejection is not treated as telemetry acceptance", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const client = createEmailClient({
        adapters: [
          adapter("smtp", () => ({ adapter: "smtp", accepted: [], rejected: ["a@example.com"] })),
        ],
      });

      await client.sendPersonalized({
        message,
        recipients: [{ to: "a@example.com", variables: {} }],
      });
      expect(
        capture.events.find((item) => item.event === "email adapter attempted")?.properties,
      ).toMatchObject({
        adapter_resolved_count: 1,
        accepted_message_count: 0,
        accepted_recipient_count: 0,
        rejected_recipient_count: 1,
        unknown_recipient_count: 0,
      });
    } finally {
      resetTelemetry();
    }
  });
});
