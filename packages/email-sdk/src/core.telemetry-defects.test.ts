import { afterEach, describe, expect, test } from "bun:test";

import { createEmailClient } from "./core.js";
import { EmailAdapterError, EmailMiddlewareError } from "./errors.js";
import { resetTelemetry, setSharedTelemetry } from "./telemetry.js";
import { adapter, message, telemetryCapture } from "../test-support/core-fixtures.js";

function captured() {
  const capture = telemetryCapture();
  setSharedTelemetry(capture.telemetry);

  return capture;
}

function rejectWith(status: number) {
  return () => {
    throw new EmailAdapterError(`resend failed with ${status}`, { adapter: "resend", status });
  };
}

function crash(): never {
  // What a real adapter bug throws: reading a field the provider did not send.
  throw new TypeError("Cannot read properties of undefined (reading 'id')");
}

afterEach(() => {
  resetTelemetry();
});

describe("send telemetry error reporting", () => {
  test("a provider rejection is counted but never reported as an exception", async () => {
    const { events, exceptions } = captured();
    const client = createEmailClient({ adapters: [adapter("resend", rejectWith(401))] });

    await expect(client.send(message)).rejects.toThrow("All configured email adapters failed.");

    expect(exceptions).toHaveLength(0);
    expect(events.find((item) => item.event === "email sent")?.properties).toMatchObject({
      success: false,
      error_code: "route_error",
      failure_kind: "auth",
    });
    expect(
      events.find((item) => item.event === "email adapter attempted")?.properties,
    ).toMatchObject({
      failure_kind: "auth",
      http_status: 401,
    });
  });

  test("a crash inside a built-in adapter is reported as the adapter failure", async () => {
    const { events, exceptions } = captured();
    const client = createEmailClient({ adapters: [adapter("resend", crash)] });

    await expect(client.send(message)).rejects.toThrow();

    expect(exceptions).toHaveLength(1);
    const [reported] = exceptions;
    expect(reported).toBeInstanceOf(EmailAdapterError);
    expect(reported instanceof Error ? reported.cause : undefined).toBeInstanceOf(TypeError);
    expect(events.find((item) => item.event === "email sent")?.properties).toMatchObject({
      failure_kind: "unexpected",
    });
  });

  test("the defect is reported even when a fallback adapter fails last", async () => {
    const { exceptions } = captured();

    const client = createEmailClient({
      adapters: [adapter("resend", crash), adapter("postmark", rejectWith(500))],
      fallback: ["resend", "postmark"],
    });

    await expect(client.send(message)).rejects.toThrow();

    expect(exceptions).toHaveLength(1);
    expect(exceptions[0] instanceof EmailAdapterError ? exceptions[0].adapter : "").toBe("resend");
  });

  test("a crash inside a caller-registered adapter is not the SDK's defect", async () => {
    const { exceptions } = captured();
    const client = createEmailClient({ adapters: [adapter("acme-internal", crash)] });

    await expect(client.send(message)).rejects.toThrow();

    expect(exceptions).toHaveLength(0);
  });

  test("a throwing middleware is the caller's error", async () => {
    const { events, exceptions } = captured();

    const client = createEmailClient({
      adapters: [adapter("resend")],
      plugins: [
        {
          id: "caller-middleware",
          middleware: [
            {
              beforeSend() {
                throw new TypeError("caller middleware bug");
              },
            },
          ],
        },
      ],
    });

    await expect(client.send(message)).rejects.toBeInstanceOf(EmailMiddlewareError);

    expect(exceptions).toHaveLength(0);
    expect(events.find((item) => item.event === "email sent")?.properties).toMatchObject({
      failure_kind: "caller",
    });
  });
});
