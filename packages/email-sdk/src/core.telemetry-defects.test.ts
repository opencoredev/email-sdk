import { afterEach, describe, expect, test } from "bun:test";

import { createEmailClient } from "./core.js";
import { EmailAdapterError, EmailMiddlewareError } from "./errors.js";
import { resetTelemetry, setSharedTelemetry } from "./telemetry.js";
import type { EmailAdapter } from "./types.js";
import { BUILT_IN_ADAPTER_CAPABILITIES, isBuiltInAdapter } from "./utils.js";
import { adapter, message, telemetryCapture } from "../test-support/core-fixtures.js";

function captured() {
  const capture = telemetryCapture();
  setSharedTelemetry(capture.telemetry);

  return capture;
}

/** An adapter the SDK ships, as far as ownership checks can tell. */
function builtIn<const Name extends "resend" | "postmark">(
  name: Name,
  send?: EmailAdapter<Name>["send"],
) {
  return adapter(name, send, { capabilities: BUILT_IN_ADAPTER_CAPABILITIES[name] });
}

function rejectWith(status: number, name = "resend") {
  return () => {
    throw new EmailAdapterError(`${name} failed with ${status}`, { adapter: name, status });
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
    const client = createEmailClient({ adapters: [builtIn("resend", rejectWith(401))] });

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
    const client = createEmailClient({ adapters: [builtIn("resend", crash)] });

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
    const { events, exceptions } = captured();
    const attempted: string[] = [];

    const client = createEmailClient({
      adapters: [
        builtIn("resend", () => {
          attempted.push("resend");
          crash();
        }),
        builtIn("postmark", () => {
          attempted.push("postmark");
          rejectWith(500, "postmark")();
        }),
      ],
      fallback: { adapters: ["postmark"], onUnknownDelivery: "continue" },
    });

    await expect(client.send(message)).rejects.toThrow();

    expect(attempted).toEqual(["resend", "postmark"]);
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0] instanceof EmailAdapterError ? exceptions[0].adapter : "").toBe("resend");
    expect(events.find((item) => item.event === "email sent")?.properties).toMatchObject({
      failure_kind: "provider_error",
    });
  });

  test("a crash inside a caller-registered adapter is not the SDK's defect", async () => {
    const { exceptions } = captured();
    const client = createEmailClient({ adapters: [adapter("acme-internal", crash)] });

    await expect(client.send(message)).rejects.toThrow();

    expect(exceptions).toHaveLength(0);
  });

  test("a caller adapter that borrows a built-in name is still the caller's", async () => {
    const { exceptions } = captured();
    const client = createEmailClient({ adapters: [adapter("resend", crash)] });

    await expect(client.send(message)).rejects.toThrow();

    expect(exceptions).toHaveLength(0);
  });

  test("a crash in a caller adapter's validate is not the SDK's defect", async () => {
    const { exceptions } = captured();

    const client = createEmailClient({
      adapters: [
        adapter("acme-internal", undefined, {
          validate() {
            crash();
          },
        }),
      ],
    });

    await expect(client.send(message)).rejects.toBeInstanceOf(EmailAdapterError);

    expect(exceptions).toHaveLength(0);
  });

  test.each([
    ["shouldRetry", { maxAttempts: 2, shouldRetry: () => crash() }],
    ["delay", { maxAttempts: 2, shouldRetry: () => true, delay: () => crash() }],
  ])("a crash in the caller's retry %s callback is not the SDK's defect", async (_label, retry) => {
    const { exceptions } = captured();
    const client = createEmailClient({ adapters: [builtIn("resend", rejectWith(500))], retry });

    await expect(client.send(message)).rejects.toThrow();

    expect(exceptions).toHaveLength(0);
  });

  test.each([
    ["client", true],
    ["per-send", false],
  ])("a crash in a %s retry callback during a personalized send is not the SDK's defect", async (_label, onClient) => {
    const { exceptions } = captured();
    const retry = { maxAttempts: 2, shouldRetry: () => crash() };

    const client = createEmailClient({
      adapters: [builtIn("resend", rejectWith(500))],
      retry: onClient ? retry : undefined,
    });

    const sending = client.sendPersonalized(
      {
        message: { from: message.from, subject: message.subject, text: message.text },
        recipients: [{ to: "a@example.com", variables: {} }],
      },
      onClient ? undefined : { retry },
    );

    await expect(sending).rejects.toThrow();

    expect(exceptions).toHaveLength(0);
  });

  test("a caller adapter registered as unknown is still the caller's", async () => {
    const { exceptions } = captured();
    const client = createEmailClient({ adapters: [adapter("unknown", crash)] });

    await expect(client.send(message)).rejects.toThrow();

    expect(exceptions).toHaveLength(0);
  });

  test("a malformed provider reply is the provider's fault", async () => {
    const { events, exceptions } = captured();

    const client = createEmailClient({
      adapters: [
        builtIn("resend", () => {
          JSON.parse("<html>Bad gateway</html>");

          return { adapter: "resend", id: "never" };
        }),
      ],
    });

    await expect(client.send(message)).rejects.toThrow();

    expect(exceptions).toHaveLength(0);
    expect(events.find((item) => item.event === "email sent")?.properties).toMatchObject({
      failure_kind: "provider_error",
    });
  });

  test("a header the caller configured badly is the caller's error", async () => {
    const { events, exceptions } = captured();

    const client = createEmailClient({
      adapters: [
        builtIn("resend", () => {
          // What `new Headers({ ...options.headers })` throws for a bad name.
          new Headers({ "x bad": "1" });

          return { adapter: "resend", id: "never" };
        }),
      ],
    });

    await expect(client.send(message)).rejects.toThrow();

    expect(exceptions).toHaveLength(0);
    expect(events.find((item) => item.event === "email sent")?.properties).toMatchObject({
      failure_kind: "caller",
    });
  });

  test("an error with a throwing getter cannot change the send failure or stop fallback", async () => {
    captured();
    const attempted: string[] = [];

    const hostile = new Error("adapter failed");
    Object.defineProperty(hostile, "cause", {
      get() {
        throw new Error("getter exploded");
      },
    });

    const client = createEmailClient({
      adapters: [
        builtIn("resend", () => {
          attempted.push("resend");
          throw hostile;
        }),
        builtIn("postmark", () => {
          attempted.push("postmark");

          return { adapter: "postmark", id: "pm_1" };
        }),
      ],
      fallback: { adapters: ["postmark"], onUnknownDelivery: "continue" },
    });

    await expect(client.send(message)).resolves.toMatchObject({ adapter: "postmark" });
    expect(attempted).toEqual(["resend", "postmark"]);
  });

  test("a custom adapter error with a throwing cause getter still surfaces as the route error", async () => {
    captured();
    const hostile = new EmailAdapterError("acme failed", { adapter: "acme-internal" });
    Object.defineProperty(hostile, "cause", {
      get() {
        throw new Error("getter exploded");
      },
    });

    const client = createEmailClient({
      adapters: [
        adapter("acme-internal", () => {
          throw hostile;
        }),
      ],
    });

    await expect(client.send(message)).rejects.toThrow("All configured email adapters failed.");
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

describe("isBuiltInAdapter", () => {
  test("trusts the mark on SDK capabilities, not their shape or the adapter's name", () => {
    const copied = { ...BUILT_IN_ADAPTER_CAPABILITIES.resend };

    // Real factories, including CommonJS subpath imports, are checked against
    // the packed tarball in scripts/check-package-tarballs.ts.
    expect(isBuiltInAdapter(builtIn("resend"))).toBe(true);
    expect(isBuiltInAdapter(adapter("relay", undefined, { capabilities: BUILT_IN_ADAPTER_CAPABILITIES.smtp }))).toBe(true);
    expect(isBuiltInAdapter(adapter("resend", undefined, { capabilities: copied }))).toBe(false);
    expect(isBuiltInAdapter(undefined)).toBe(false);
  });

  test("tolerates a plain JavaScript adapter without capabilities", () => {
    const legacy = adapter("legacy");
    // A JavaScript caller can skip the field the types require.
    Reflect.deleteProperty(legacy, "capabilities");

    expect(isBuiltInAdapter(legacy)).toBe(false);
  });
});
