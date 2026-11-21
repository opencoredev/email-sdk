import { describe, expect, test } from "bun:test";

import { createEmailClient } from "./core.js";
import {
  EmailAbortError,
  EmailAdapterError,
  EmailAllRecipientsFailedError,
  EmailRouteError,
} from "./errors.js";
import { resetTelemetry, setSharedTelemetry } from "./telemetry.js";
import type { EmailAdapter, EmailPersonalizedInput, EmailPersonalizedResult } from "./types.js";
import { adapter, message, telemetryCapture } from "../test-support/core-fixtures.js";

const input: EmailPersonalizedInput = {
  message: { from: "hello@example.com", subject: "Hi %recipient.name%", text: "Hi" },
  recipients: [
    { to: "ada@example.com", variables: { name: "Ada" } },
    { to: "linus@example.com", variables: { name: "Linus" } },
  ],
};

/** A native personalized adapter whose result comes from a plain JavaScript implementation. */
function nativeAdapter<const Name extends string>(
  name: Name,
  personalized: () => EmailPersonalizedResult<Name>,
): EmailAdapter<Name> {
  return adapter(name, undefined, { sendPersonalized: personalized });
}

/** The shape a JavaScript adapter can return although the type requires `accepted`. */
function untypedResult<const Name extends string>(result: { adapter: Name; id?: string }) {
  // SAFETY: deliberately false. The test reproduces a plain JavaScript adapter that omits the
  // required lists, which is exactly the input core must survive.
  return result as EmailPersonalizedResult<Name>;
}

describe("native personalized results", () => {
  test("a result without accepted fails as an adapter error, not a TypeError", async () => {
    const client = createEmailClient({
      adapters: [nativeAdapter("native", () => untypedResult({ adapter: "native", id: "batch_1" }))],
      telemetry: false,
    });

    const error = await client.sendPersonalized(input).catch((cause: unknown) => cause);

    expect(error).not.toBeInstanceOf(TypeError);
    expect(error).toBeInstanceOf(EmailAllRecipientsFailedError);

    const [failure] = error instanceof EmailAllRecipientsFailedError ? error.failures : [];
    expect(failure).toBeInstanceOf(EmailAdapterError);
    expect(failure?.message).toBe("native.sendPersonalized resolved without an accepted recipient list.");
  });

  test("the missing list counts as unknown delivery, so fallback does not risk a duplicate", async () => {
    const backupCalls: string[] = [];

    const client = createEmailClient({
      adapters: [
        nativeAdapter("native", () => untypedResult({ adapter: "native" })),
        adapter("backup", (value) => {
          backupCalls.push(String(value.to));

          return { adapter: "backup", id: "b_1" };
        }),
      ],
      fallback: { adapters: ["backup"] },
      telemetry: false,
    });

    const error = await client.sendPersonalized(input).catch((cause: unknown) => cause);
    const failures = error instanceof EmailAllRecipientsFailedError ? error.failures : [];

    expect(failures.map((failure) => failure.delivery)).toEqual(["unknown"]);
    expect(backupCalls).toEqual([]);
  });

  test("a result without rejected is read as nothing rejected", async () => {
    const client = createEmailClient({
      adapters: [
        nativeAdapter("native", () => ({
          ...untypedResult({ adapter: "native", id: "batch_1" }),
          accepted: ["ada@example.com", "linus@example.com"],
        })),
      ],
      telemetry: false,
    });

    const result = await client.sendPersonalized(input);

    expect(result.accepted).toEqual(["ada@example.com", "linus@example.com"]);
    expect(result.rejected).toEqual([]);
  });
});

describe("abort during beforeSend middleware", () => {
  test("sendPersonalized stops before validating or calling the adapter", async () => {
    const controller = new AbortController();
    const calls: string[] = [];

    const client = createEmailClient({
      adapters: [
        adapter(
          "expanded",
          (value) => {
            calls.push(`send:${String(value.to)}`);

            return { adapter: "expanded", id: "x" };
          },
          {
            validate(value) {
              calls.push(`validate:${String(value.to)}`);
            },
          },
        ),
      ],
      plugins: [
        {
          id: "slow",
          middleware: [
            {
              async beforeSend() {
                controller.abort(new Error("deadline"));
              },
            },
          ],
        },
      ],
      telemetry: false,
    });

    const error = await client
      .sendPersonalized(input, { signal: controller.signal })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(EmailAbortError);
    expect(error).not.toBeInstanceOf(EmailRouteError);
    expect(calls).toEqual([]);
  });
});

describe("telemetry facts after beforeSend middleware", () => {
  test("send reports recipients, attachments, and sendAt that middleware added", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const client = createEmailClient({
        adapters: [adapter("memory")],
        plugins: [
          {
            id: "enrich",
            middleware: [
              {
                beforeSend(event) {
                  return {
                    message: {
                      ...event.message,
                      cc: ["audit@example.com", "ops@example.com"],
                      attachments: [{ filename: "a.txt", content: "a" }],
                      sendAt: "2030-01-01T00:00:00Z",
                    },
                  };
                },
              },
            ],
          },
        ],
      });

      await client.send(message);

      expect(capture.events.find((item) => item.event === "email sent")?.properties).toMatchObject({
        recipients: 3,
        has_attachments: true,
        used_send_at: true,
      });
    } finally {
      resetTelemetry();
    }
  });

  test("sendPersonalized reports attachments and sendAt that middleware added", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const client = createEmailClient({
        adapters: [adapter("memory")],
        plugins: [
          {
            id: "enrich",
            middleware: [
              {
                beforeSend(event) {
                  return {
                    message: {
                      ...event.message,
                      attachments: [{ filename: "a.txt", content: "a" }],
                      sendAt: "2030-01-01T00:00:00Z",
                    },
                  };
                },
              },
            ],
          },
        ],
      });

      await client.sendPersonalized(input);

      expect(capture.events.find((item) => item.event === "email sent")?.properties).toMatchObject({
        recipients: 2,
        has_attachments: true,
        used_send_at: true,
      });
    } finally {
      resetTelemetry();
    }
  });
});
