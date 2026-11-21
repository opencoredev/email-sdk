import { expect, test } from "bun:test";
import { createEmailClient } from "./core.js";
import { resetTelemetry, setSharedTelemetry } from "./telemetry.js";
import { adapter, telemetryCapture } from "../test-support/core-fixtures.js";

test("ReadonlyMapView.forEach preserves the standard thisArg contract and freezes exposed views", () => {
  const client = createEmailClient({ adapters: [adapter("memory")], telemetry: false });
  const marker = { tag: "bound-context" };
  let observedTag: string | undefined;

  expect(Object.isFrozen(client.adapters)).toBe(true);
  expect(Object.isFrozen(Object.getPrototypeOf(client.adapters))).toBe(true);

  client.adapters.forEach(function (this: typeof marker) {
    observedTag = this.tag;
  }, marker);

  expect(observedTag).toBe("bound-context");
});

test("post-middleware telemetry reflects in-place message mutations", async () => {
  const capture = telemetryCapture();
  setSharedTelemetry(capture.telemetry);

  try {
    const client = createEmailClient({
      adapters: [adapter("memory", () => ({ adapter: "memory", id: "msg_1" }))],
      plugins: [
        {
          id: "in-place-enrich",
          middleware: [
            {
              beforeSend({ message }) {
                message.cc = ["audit@example.com"];
                message.attachments = [{ filename: "a.txt", content: "a" }];
                message.sendAt = "2030-01-01T00:00:00Z";
              },
            },
          ],
        },
      ],
    });

    await client.send({
      from: "hello@example.com",
      to: "user@example.com",
      subject: "Hi",
      text: "Hi",
    });

    const sentEvent = capture.events.find((item) => item.event === "email sent");
    expect(sentEvent?.properties).toMatchObject({
      recipients: 2,
      has_attachments: true,
      used_send_at: true,
    });
  } finally {
    resetTelemetry();
  }
});

test("send() aborts after beforeSend before validation and reports rerouted adapter on failure", async () => {
  const controller = new AbortController();
  let validated = false;

  const client = createEmailClient({
    adapters: [
      {
        ...adapter("resend", () => ({ adapter: "resend", id: "1" })),
        validate() {
          validated = true;
        },
      },
    ],
    plugins: [
      {
        id: "abort-in-before-send",
        middleware: [
          {
            beforeSend() {
              controller.abort("stopped");
            },
          },
        ],
      },
    ],
    telemetry: false,
  });

  await expect(
    client.send(
      { from: "a@example.com", to: "b@example.com", subject: "s", text: "t" },
      { signal: controller.signal },
    ),
  ).rejects.toMatchObject({ code: "aborted" });
  expect(validated).toBe(false);

  const capture = telemetryCapture();
  setSharedTelemetry(capture.telemetry);

  try {
    const routed = createEmailClient({
      adapters: [
        adapter("resend", () => ({ adapter: "resend", id: "1" })),
        adapter("postmark", () => {
          throw new Error("boom");
        }),
      ],
      plugins: [
        {
          id: "reroute",
          middleware: [
            {
              beforeSend({ message, options }) {
                return { message, options: { ...options, adapter: "postmark" } };
              },
            },
          ],
        },
      ],
    });

    await expect(
      routed.send(
        { from: "a@example.com", to: "b@example.com", subject: "s", text: "t" },
        { adapter: "resend" },
      ),
    ).rejects.toThrow();

    const failedEvent = capture.events.find((item) => item.event === "email sent");
    expect(failedEvent?.properties).toMatchObject({ adapter: "postmark", success: false });

    // Rerouting to an unknown adapter in beforeSend reports the rerouted adapter in telemetry.
    capture.events.length = 0;

    const badRoute = createEmailClient({
      adapters: [adapter("resend", () => ({ adapter: "resend", id: "1" }))],
      plugins: [
        {
          id: "reroute-missing",
          middleware: [
            {
              beforeSend({ message, options }) {
                return { message, options: { ...options, adapter: "postmark" } };
              },
            },
          ],
        },
      ],
    });

    await expect(
      badRoute.send({ from: "a@example.com", to: "b@example.com", subject: "s", text: "t" }),
    ).rejects.toThrow();
    expect(capture.events.find((item) => item.event === "email sent")?.properties).toMatchObject({
      adapter: "postmark",
      success: false,
    });

    // sendMany with sparse/malformed items must not throw TypeError even when telemetry is enabled.
    capture.events.length = 0;

    const batchClient = createEmailClient({
      adapters: [adapter("resend", () => ({ adapter: "resend", id: "ok" }))],
    });

    const malformed = JSON.parse(
      '[null,{},{"message":null},{"message":{"from":"a@example.com","to":"b@example.com","subject":"s","text":"t"}}]',
    );

    const batchResults = await batchClient.sendMany(malformed);

    expect(batchResults).toHaveLength(4);
    expect(batchResults[0]?.ok).toBe(false);
    expect(batchResults[1]?.ok).toBe(false);
    expect(batchResults[2]?.ok).toBe(false);
    expect(batchResults[3]?.ok).toBe(true);
    expect(
      capture.events.find((item) => item.event === "email batch sent")?.properties,
    ).toMatchObject({ message_count: 4, succeeded: 1, failed: 3, recipients: 1 });
  } finally {
    resetTelemetry();
  }
});
