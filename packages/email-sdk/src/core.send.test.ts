import { describe, expect, test } from "bun:test";
import { createEmailClient } from "./core.js";
import { EmailMiddlewareError, EmailValidationError } from "./errors.js";
import type { EmailMessage } from "./types.js";
import { adapter, capabilities, message } from "../test-support/core-fixtures.js";

describe("createEmailClient v1", () => {
  test("uses the first adapter and returns the normalized result", async () => {
    const client = createEmailClient({ adapters: [adapter("primary")] });
    const result = await client.send(message);

    expect(client.defaultAdapter).toBe("primary");
    expect(client.adapter("primary").name).toBe("primary");
    expect(result).toEqual({ adapter: "primary", id: "primary_1" });
    expect("provider" in result).toBe(false);
    expect("messageId" in result).toBe(false);
  });

  test("fails construction for duplicate, unknown default, and unknown fallback names", () => {
    expect(() => createEmailClient({ adapters: [adapter("same"), adapter("same")] })).toThrow(
      'Duplicate email adapter "same".',
    );
    expect(() =>
      createEmailClient({
        adapters: [adapter("one")],
        // SAFETY: deliberately unregistered name; this asserts the runtime check that backs the type.
        defaultAdapter: "missing" as "one",
      }),
    ).toThrow('Email adapter "missing" is not registered.');
    expect(() =>
      createEmailClient({
        adapters: [adapter("one")],
        // SAFETY: deliberately unregistered name; this asserts the runtime check that backs the type.
        fallback: { adapters: ["missing" as "one"] },
      }),
    ).toThrow('Email adapter "missing" is not registered.');
  });

  test("validates without sending and validates every candidate route", async () => {
    let sends = 0;

    const primary = adapter("primary", () => {
      sends += 1;

      return { adapter: "primary" };
    });

    const backup = adapter("backup", undefined, {
      capabilities: { ...capabilities, repeatedHeaders: false },
    });

    const client = createEmailClient({
      adapters: [primary, backup],
      fallback: { adapters: ["backup"] },
    });

    await expect(client.validate(message)).resolves.toEqual({ adapter: "primary", warnings: [] });
    expect(sends).toBe(0);

    await expect(
      client.validate({
        ...message,
        headers: [
          { name: "X-Test", value: "one" },
          { name: "x-test", value: "two" },
        ],
      }),
    ).rejects.toBeInstanceOf(EmailValidationError);
    expect(sends).toBe(0);
  });

  test("enforces message, attachment, and zoned RFC 3339 validation", async () => {
    const client = createEmailClient({ adapters: [adapter("primary")] });

    // SAFETY: deliberately drops both bodies to reach the runtime html/text check.
    await expect(client.validate({ ...message, text: undefined } as EmailMessage)).rejects.toThrow(
      "requires either html or text",
    );
    await expect(
      client.validate({
        ...message,
        // SAFETY: deliberately invalid attachment with neither content nor path.
        attachments: [{ filename: "bad.txt" } as never],
      }),
    ).rejects.toThrow("requires exactly one of content or path");
    await expect(
      client.validate({ ...message, sendAt: "2026-07-21T01:00:00Z" }),
    ).resolves.toMatchObject({ adapter: "primary" });
    await expect(
      client.validate({ ...message, sendAt: "2026-07-21T01:00:00+02:00" }),
    ).resolves.toMatchObject({ adapter: "primary" });
    await expect(
      // SAFETY: deliberately zoneless timestamp that the RFC 3339 type rejects at compile time.
      client.validate({ ...message, sendAt: "2026-07-21T01:00:00" as never }),
    ).rejects.toThrow("must be an RFC 3339 timestamp");
  });

  test("wraps middleware exceptions but isolates hook exceptions", async () => {
    const middlewareClient = createEmailClient({
      adapters: [adapter("primary")],
      plugins: [
        {
          id: "middleware",
          middleware: [
            {
              beforeSend() {
                throw new Error("middleware failed");
              },
            },
          ],
        },
      ],
    });

    await expect(middlewareClient.send(message)).rejects.toBeInstanceOf(EmailMiddlewareError);

    const hookClient = createEmailClient({
      adapters: [adapter("primary")],
      hooks: {
        beforeSend() {
          throw new Error("hook failed");
        },
      },
    });

    await expect(hookClient.send(message)).resolves.toMatchObject({ adapter: "primary" });
  });
});
