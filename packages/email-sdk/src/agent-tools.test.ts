import { describe, expect, test } from "bun:test";

import { createEmailAgentTools } from "./agent-tools.js";
import { createEmailClient } from "./core.js";
import { EmailValidationError } from "./errors.js";
import { memoryAdapter } from "./testing.js";

function client() {
  const primary = memoryAdapter("primary");
  const backup = memoryAdapter("backup");

  return {
    primary,
    backup,
    client: createEmailClient({ adapters: [primary, backup], telemetry: false }),
  };
}

const input = {
  from: "hello@example.com",
  to: ["ada@example.com", "linus@example.com"],
  subject: "Hi",
  text: "Hello",
};

describe("createEmailAgentTools (deprecated /agent-tools)", () => {
  test("describes send_email with a JSON Schema the model can fill", () => {
    const { sendEmail } = createEmailAgentTools(client().client);

    expect(sendEmail.name).toBe("send_email");
    expect(sendEmail.description).toContain("Ask for confirmation");
    expect(sendEmail.parameters).toEqual({
      type: "object",
      required: ["from", "to", "subject"],
      properties: {
        from: { type: "string" },
        to: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
        subject: { type: "string" },
        html: { type: "string" },
        text: { type: "string" },
        adapter: { type: "string" },
        provider: { type: "string" },
      },
    });
  });

  test("sends through the default adapter and passes the message through unchanged", async () => {
    const setup = client();
    const result = await createEmailAgentTools(setup.client).sendEmail.execute(input);

    expect(result.adapter).toBe("primary");
    expect(setup.primary.raw.sent.map((sent) => sent.message)).toEqual([input]);
    expect(setup.backup.raw.sent).toHaveLength(0);
  });

  test("routes to the named adapter and strips routing fields from the message", async () => {
    const setup = client();
    const result = await createEmailAgentTools(setup.client).sendEmail.execute({ ...input, adapter: "backup" });

    expect(result.adapter).toBe("backup");
    expect(setup.backup.raw.sent[0]?.message).toEqual(input);
  });

  test("adapter wins over the legacy provider field, which still works alone", async () => {
    const setup = client();
    const tools = createEmailAgentTools(setup.client);

    await tools.sendEmail.execute({ ...input, adapter: "primary", provider: "backup" });
    await tools.sendEmail.execute({ ...input, provider: "backup" });

    expect(setup.primary.raw.sent).toHaveLength(1);
    expect(setup.backup.raw.sent).toHaveLength(1);
    expect(setup.backup.raw.sent[0]?.message).not.toHaveProperty("provider");
  });

  test("surfaces client validation errors instead of sending", async () => {
    const setup = client();

    await expect(
      createEmailAgentTools(setup.client).sendEmail.execute({ ...input, subject: "" }),
    ).rejects.toBeInstanceOf(EmailValidationError);
    expect(setup.primary.raw.sent).toHaveLength(0);
  });
});
