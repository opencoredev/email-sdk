import { describe, expect, test } from "bun:test";

import { createInboundEmailClient } from "./inbound-core.js";
import { EmailProviderNotFoundError, EmailValidationError } from "./errors.js";
import type { InboundEmail, InboundEmailAdapter } from "./inbound-types.js";

const email: InboundEmail = {
  provider: "",
  from: { email: "sender@example.com" },
  to: [{ email: "user@example.com" }],
  headers: {},
  attachments: [],
};

describe("createInboundEmailClient", () => {
  test("requires adapters", () => {
    expect(() => createInboundEmailClient({ adapters: [] })).toThrow(EmailValidationError);
  });

  test("rejects duplicate adapter names", () => {
    expect(() =>
      createInboundEmailClient({ adapters: [memoryInbound("resend"), memoryInbound("resend")] }),
    ).toThrow(EmailValidationError);
  });

  test("selects the first adapter by default", () => {
    const client = createInboundEmailClient({
      adapters: [memoryInbound("resend"), memoryInbound("mailgun")],
    });

    expect(client.defaultAdapter).toBe("resend");
  });

  test("parses with explicit adapter override", async () => {
    const client = createInboundEmailClient({
      adapters: [memoryInbound("resend"), memoryInbound("mailgun")],
    });

    const result = await client.parse({}, { adapter: "mailgun", metadata: { route: "inbound" } });

    expect(result.provider).toBe("mailgun");
    expect(result.raw).toEqual({ metadata: { route: "inbound" } });
  });

  test("throws provider-not-found style errors for unknown adapters", async () => {
    const client = createInboundEmailClient({ adapters: [memoryInbound("resend")] });

    expect(() => client.adapter("missing")).toThrow(EmailProviderNotFoundError);
    await expect(client.parse({}, { adapter: "missing" })).rejects.toBeInstanceOf(
      EmailProviderNotFoundError,
    );
  });

  test("verifies with adapter verification", async () => {
    const client = createInboundEmailClient({
      adapters: [
        memoryInbound("signed", {
          verify: () => false,
        }),
      ],
    });

    await expect(client.verify({})).resolves.toBe(false);
  });

  test("returns true for adapters without verification", async () => {
    const client = createInboundEmailClient({ adapters: [memoryInbound("unsigned")] });

    await expect(client.verify({})).resolves.toBe(true);
  });
});

function memoryInbound(
  name: string,
  overrides: Partial<InboundEmailAdapter> = {},
): InboundEmailAdapter {
  return {
    name,
    parse(_input, context) {
      return {
        ...email,
        raw: {
          metadata: context.metadata,
        },
      };
    },
    ...overrides,
  };
}
