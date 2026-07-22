import { afterEach, describe, expect, test } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  EmailAdapterError,
  type EmailMessage,
  type EmailSendOptions,
  type EmailSendResult,
} from "@opencoredev/email-sdk";

import { createEmailMcpServer } from "../src/runtime.js";
import { APPROVAL_BODY_MAX_LENGTH } from "../src/policy.js";
import type { EmailMcpClient } from "../src/types.js";

const openClients: Client[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
});

describe("Email SDK MCP protocol", () => {
  test("registers only status and validate by default", async () => {
    const fake = new FakeEmailClient();
    const { client } = await connect(fake);
    const tools = await client.listTools();

    expect(tools.tools.map(({ name }) => name).sort()).toEqual([
      "email_configuration_status",
      "email_validate",
    ]);
    expect(tools.tools.every(({ outputSchema }) => outputSchema !== undefined)).toBe(true);
    expect(tools.tools.every(({ inputSchema }) => inputSchema.additionalProperties === false)).toBe(
      true,
    );
  });

  test("registers a reference-only, non-idempotent send tool when explicitly enabled", async () => {
    const fake = new FakeEmailClient();
    const { client } = await connect(fake, { sendEnabled: true }, () => "accept");
    const tools = await client.listTools();
    const send = tools.tools.find(({ name }) => name === "email_send");

    expect(send?.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ["validationReference"],
      properties: { validationReference: { type: "string" } },
    });
    expect(send?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  test("returns only allowlisted configuration fields", async () => {
    const canary = "CANARY_SENDER_DO_NOT_LEAK";
    const { client } = await connect(undefined, {
      missingEnvironment: ["RESEND_API_KEY", "EMAIL_SDK_MCP_FROM"],
      sender: canary,
    });
    const result = await client.callTool({
      name: "email_configuration_status",
      arguments: {},
    });
    const serialized = JSON.stringify(result);

    expect(result.isError).not.toBe(true);
    expect(serialized).toContain("RESEND_API_KEY");
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain("sender");
  });

  test("validates without sending and keeps tool output content-redacted", async () => {
    const fake = new FakeEmailClient();
    fake.validationWarnings = [{ code: "WARNING_SECRET_CANARY", message: "CANARY_BODY" }];
    const { client } = await connect(fake);
    const result = await validate(client);
    const serialized = JSON.stringify(result);

    expect(result.isError).not.toBe(true);
    expect(fake.validateCalls).toHaveLength(1);
    expect(fake.sendCalls).toHaveLength(0);
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("CANARY_BODY");
    expect(serialized).not.toContain("WARNING_SECRET_CANARY");
    expect(serialized).not.toContain("hello@example.com");
    expect(structured(result).validationReference).toMatch(/^emv_/);
    expect(structured(result).warningCount).toBe(1);
  });

  test("emits only allowlisted telemetry when explicitly configured", async () => {
    const fake = new FakeEmailClient();
    const events: unknown[] = [];
    const { client } = await connect(fake, {
      telemetry(event) {
        events.push(event);
      },
    });

    await validate(client);

    expect(events).toEqual([{ operation: "validate", ok: true, durationMs: expect.any(Number) }]);
    expect(Object.keys(events[0] as object).sort()).toEqual(["durationMs", "ok", "operation"]);
    expect(JSON.stringify(events)).not.toContain("person@example.com");
    expect(JSON.stringify(events)).not.toContain("CANARY_BODY");
  });

  test("strict input schemas reject secret-bearing and excluded fields", async () => {
    const canary = "sk_live_DO_NOT_LEAK";
    const fake = new FakeEmailClient();
    const { client } = await connect(fake);
    const result = await client.callTool({
      name: "email_validate",
      arguments: {
        to: "person@example.com",
        subject: "Subject",
        text: "body",
        apiKey: canary,
        path: "/secret/file",
        baseUrl: "https://attacker.invalid",
      },
    });

    expect(result.isError).toBe(true);
    expect(fake.validateCalls).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(canary);
  });

  test("rejects recipient-list smuggling before policy validation", async () => {
    const fake = new FakeEmailClient();
    const { client } = await connect(fake, {
      policy: { allowedDomains: ["example.com"] },
    });

    for (const to of [
      "attacker@evil.test, allowed@example.com",
      "Evil <attacker@evil.test>, Allowed <allowed@example.com>",
      "attacker@evil.test\nBcc: allowed@example.com",
    ]) {
      const result = await client.callTool({
        name: "email_validate",
        arguments: { to, subject: "Subject", text: "body" },
      });

      expect(result.isError).toBe(true);
    }

    expect(fake.validateCalls).toHaveLength(0);
  });

  test("fails closed when elicitation is unavailable", async () => {
    const fake = new FakeEmailClient();
    const { client } = await connect(fake, { sendEnabled: true });
    const validation = await validate(client);
    const result = await client.callTool({
      name: "email_send",
      arguments: { validationReference: structured(validation).validationReference },
    });

    expect(result.isError).toBe(true);
    expect(structured(result)).toMatchObject({ ok: false, code: "approval_unavailable" });
    expect(fake.sendCalls).toHaveLength(0);
  });

  test("elicits the exact stored request including text and HTML, sends once, and returns a safe projection", async () => {
    const fake = new FakeEmailClient();
    fake.sendResult = {
      adapter: "resend",
      id: "https://provider.invalid/receipts/person@example.com",
      accepted: ["person@example.com"],
      rejected: [],
      raw: { secret: "RAW_CANARY" },
    };
    let approvalMessage = "";
    const { client } = await connect(fake, { sendEnabled: true }, (message) => {
      approvalMessage = message;
      return "accept";
    });
    const validation = await validate(client, {
      to: "person@example.com",
      cc: "copy@example.com",
      bcc: "audit@example.com",
      replyTo: "Support <support@example.com>",
      subject: "CANARY_SUBJECT",
      text: "CANARY_TEXT_BODY\nSecond line.",
      html: "<p>CANARY_HTML_BODY</p>",
    });
    const result = await client.callTool({
      name: "email_send",
      arguments: { validationReference: structured(validation).validationReference },
    });
    const output = structured(result);
    const serialized = JSON.stringify(result);

    expect(result.isError).not.toBe(true);
    expect(approvalMessage).toContain("From: Acme <hello@example.com>");
    expect(approvalMessage).toContain("To: person@example.com");
    expect(approvalMessage).toContain("Cc: copy@example.com");
    expect(approvalMessage).toContain("Bcc: audit@example.com");
    expect(approvalMessage).toContain("Reply-To: Support <support@example.com>");
    expect(approvalMessage).toContain("Subject: CANARY_SUBJECT");
    expect(approvalMessage).toContain("Attachments: 0");
    expect(approvalMessage).toContain(`Text body (29/${APPROVAL_BODY_MAX_LENGTH} chars):`);
    expect(approvalMessage).toContain("CANARY_TEXT_BODY\nSecond line.");
    expect(approvalMessage).toContain(`HTML body (23/${APPROVAL_BODY_MAX_LENGTH} chars):`);
    expect(approvalMessage).toContain("<p>CANARY_HTML_BODY</p>");
    expect(approvalMessage).not.toContain("RAW_CANARY");
    expect(approvalMessage).not.toContain("provider.invalid");
    expect(fake.sendCalls).toHaveLength(1);
    expect(fake.sendCalls[0]?.options).toMatchObject({
      retry: { maxAttempts: 1 },
      fallback: { adapters: [], onUnknownDelivery: "stop" },
    });
    expect(fake.sendCalls[0]?.options?.idempotencyKey).toMatch(/^email-mcp:emv_/);
    expect(output).toMatchObject({
      ok: true,
      status: "sent",
      adapter: "resend",
      acceptedCount: 1,
      rejectedCount: 0,
    });
    expect(String(output.receiptId)).toMatch(/^receipt_[a-f0-9]{24}$/);
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("RAW_CANARY");
    expect(serialized).not.toContain("provider.invalid");
  });

  test("approval body disclosure shows exact-limit text and html completely", async () => {
    const fake = new FakeEmailClient();
    let approvalMessage = "";
    const textHead = "TEXT_HEAD_CANARY";
    const textTail = "TEXT_TAIL_CANARY";
    const htmlHead = "<p>HTML_HEAD_CANARY</p>";
    const htmlTail = "<p>HTML_TAIL_CANARY</p>";
    const exactText = `${textHead}${"A".repeat(APPROVAL_BODY_MAX_LENGTH - textHead.length - textTail.length)}${textTail}`;
    const exactHtml = `${htmlHead}${"B".repeat(APPROVAL_BODY_MAX_LENGTH - htmlHead.length - htmlTail.length)}${htmlTail}`;
    const { client } = await connect(fake, { sendEnabled: true }, (message) => {
      approvalMessage = message;
      return "decline";
    });
    const validation = await validate(client, {
      to: "person@example.com",
      subject: "Exact body approval",
      text: exactText,
      html: exactHtml,
    });

    await client.callTool({
      name: "email_send",
      arguments: { validationReference: structured(validation).validationReference },
    });

    expect(approvalMessage).toContain(`Text body (${APPROVAL_BODY_MAX_LENGTH}/${APPROVAL_BODY_MAX_LENGTH} chars):\n${exactText}`);
    expect(approvalMessage).toContain(`HTML body (${APPROVAL_BODY_MAX_LENGTH}/${APPROVAL_BODY_MAX_LENGTH} chars):\n${exactHtml}`);
    expect(approvalMessage).toContain(textHead);
    expect(approvalMessage).toContain(textTail);
    expect(approvalMessage).toContain(htmlHead);
    expect(approvalMessage).toContain(htmlTail);
    expect(approvalMessage).not.toContain("preview first");
    expect(approvalMessage).not.toContain("chars omitted");
    expect(approvalMessage).not.toContain("sha256:");
    expect(fake.sendCalls).toHaveLength(0);
  });

  test.each([
    ["text", { text: `${"A".repeat(APPROVAL_BODY_MAX_LENGTH)}TEXT_OVER_LIMIT_CANARY` }],
    ["html", { html: `${"<b>x</b>".repeat(500)}HTML_OVER_LIMIT_CANARY` }],
  ] as const)("rejects oversize %s body before adapter validation or storage", async (_bodyKind, body) => {
    const fake = new FakeEmailClient();
    let approvalMessage = "";
    const { client } = await connect(fake, { sendEnabled: true }, (message) => {
      approvalMessage = message;
      return "accept";
    });

    const validation = await client.callTool({
      name: "email_validate",
      arguments: {
        to: "person@example.com",
        subject: "Oversize body approval",
        ...body,
      },
    });

    expect(validation.isError).toBe(true);
    expect(structured(validation).code).toBe("policy_denied");
    expect(fake.validateCalls).toHaveLength(0);

    const send = await client.callTool({
      name: "email_send",
      arguments: { validationReference: "emv_oversizeRejectedBeforeStorage" },
    });
    expect(structured(send).code).toBe("reference_not_found");
    expect(approvalMessage).toBe("");
    expect(fake.sendCalls).toHaveLength(0);
  });

  test("concurrent replay results in at most one adapter call", async () => {
    const fake = new FakeEmailClient();
    const { client } = await connect(fake, { sendEnabled: true }, () => "accept");
    const validation = await validate(client);
    const validationReference = structured(validation).validationReference;
    const [first, second] = await Promise.all([
      client.callTool({ name: "email_send", arguments: { validationReference } }),
      client.callTool({ name: "email_send", arguments: { validationReference } }),
    ]);

    expect(fake.sendCalls).toHaveLength(1);
    expect([structured(first).code, structured(second).code]).toContain("reference_used");
  });

  test.each(["decline", "cancel"] as const)("%s approval sends zero emails", async (action) => {
    const fake = new FakeEmailClient();
    const { client } = await connect(fake, { sendEnabled: true }, () => action);
    const validation = await validate(client);
    const result = await client.callTool({
      name: "email_send",
      arguments: { validationReference: structured(validation).validationReference },
    });

    expect(result.isError).toBe(true);
    expect(structured(result).code).toBe(
      action === "decline" ? "approval_declined" : "approval_cancelled",
    );
    expect(fake.sendCalls).toHaveLength(0);
  });

  test("approval timeout sends zero emails", async () => {
    const fake = new FakeEmailClient();
    const { client } = await connect(
      fake,
      { sendEnabled: true, policy: { approvalTimeoutMs: 5 } },
      () => new Promise(() => undefined),
    );
    const validation = await validate(client);
    const result = await client.callTool({
      name: "email_send",
      arguments: { validationReference: structured(validation).validationReference },
    });

    expect(structured(result).code).toBe("approval_timeout");
    expect(fake.sendCalls).toHaveLength(0);
  });

  test("accept action without an explicit checked approval fails closed", async () => {
    const fake = new FakeEmailClient();
    const server = createEmailMcpServer({
      adapter: "resend",
      sender: "Acme <hello@example.com>",
      client: fake,
      sendEnabled: true,
    });
    const client = new Client(
      { name: "email-sdk-mcp-test", version: "1.0.0" },
      { capabilities: { elicitation: { form: {} } } },
    );
    client.setRequestHandler(ElicitRequestSchema, async () => ({
      action: "accept",
      content: { approve: false },
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    openClients.push(client);
    const validation = await validate(client);
    const result = await client.callTool({
      name: "email_send",
      arguments: { validationReference: structured(validation).validationReference },
    });

    expect(result.isError).toBe(true);
    expect(structured(result).code).toBe("approval_declined");
    expect(fake.sendCalls).toHaveLength(0);
    await server.close();
  });

  test("expires references and invalidates them across server restarts", async () => {
    let now = Date.UTC(2026, 6, 21);
    const fake = new FakeEmailClient();
    const first = await connect(fake, {
      sendEnabled: true,
      now: () => now,
      policy: { validationTtlMs: 10 },
    });
    const validation = await validate(first.client);
    const validationReference = structured(validation).validationReference;
    now += 11;
    const expired = await first.client.callTool({
      name: "email_send",
      arguments: { validationReference },
    });

    expect(structured(expired).code).toBe("reference_expired");

    const second = await connect(fake, { sendEnabled: true }, () => "accept");
    const restarted = await second.client.callTool({
      name: "email_send",
      arguments: { validationReference },
    });
    expect(structured(restarted).code).toBe("reference_not_found");
    expect(fake.sendCalls).toHaveLength(0);
  });

  test("enforces recipient allowlists before core validation", async () => {
    const fake = new FakeEmailClient();
    const { client } = await connect(fake, {
      policy: { allowedDomains: ["allowed.example"] },
    });
    const result = await client.callTool({
      name: "email_validate",
      arguments: {
        to: "person@blocked.example",
        subject: "Subject",
        text: "body",
      },
    });

    expect(structured(result).code).toBe("policy_denied");
    expect(fake.validateCalls).toHaveLength(0);
  });

  test("maps provider failures without raw details, bodies, addresses, or causes", async () => {
    const canary = "PROVIDER_SECRET_CANARY";
    const fake = new FakeEmailClient();
    fake.sendError = new EmailAdapterError(`Provider response: ${canary}`, {
      adapter: "resend",
      status: 503,
      retryable: true,
      delivery: "unknown",
      cause: { raw: canary },
    });
    const { client } = await connect(fake, { sendEnabled: true }, () => "accept");
    const validation = await validate(client);
    const result = await client.callTool({
      name: "email_send",
      arguments: { validationReference: structured(validation).validationReference },
    });
    const serialized = JSON.stringify(result);

    expect(structured(result)).toMatchObject({
      ok: false,
      code: "adapter_error",
      status: "outcome_unknown",
      adapter: "resend",
      httpStatus: 503,
      retryable: true,
      delivery: "unknown",
    });
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain("CANARY_BODY");
    expect(serialized).not.toContain("person@example.com");
  });
});

class FakeEmailClient implements EmailMcpClient {
  readonly validateCalls: Array<{ message: EmailMessage; options?: EmailSendOptions<string> }> = [];
  readonly sendCalls: Array<{ message: EmailMessage; options?: EmailSendOptions<string> }> = [];
  sendResult: EmailSendResult<string> = { adapter: "resend", id: "receipt-id" };
  sendError?: unknown;
  validationWarnings: Array<{ code: string; message: string }> = [];

  async validate(message: EmailMessage, options?: EmailSendOptions<string>) {
    this.validateCalls.push({ message, options });
    return { adapter: "resend", warnings: this.validationWarnings };
  }

  async send(message: EmailMessage, options?: EmailSendOptions<string>) {
    this.sendCalls.push({ message, options });
    if (this.sendError) {
      throw this.sendError;
    }
    return this.sendResult;
  }
}

async function connect(
  fake: FakeEmailClient | undefined,
  overrides: Partial<Parameters<typeof createEmailMcpServer>[0]> = {},
  approval?: (
    message: string,
  ) => "accept" | "decline" | "cancel" | Promise<"accept" | "decline" | "cancel">,
) {
  const server = createEmailMcpServer({
    adapter: "resend",
    sender: "Acme <hello@example.com>",
    client: fake,
    ...overrides,
  });
  const client = new Client(
    { name: "email-sdk-mcp-test", version: "1.0.0" },
    {
      capabilities: approval ? { elicitation: { form: {} } } : {},
    },
  );

  if (approval) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      const action = await approval(request.params.message);
      return {
        action,
        ...(action === "accept" ? { content: { approve: true } } : {}),
      };
    });
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  openClients.push(client);
  return { client, server };
}

function validate(
  client: Client,
  arguments_: {
    to: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
    subject: string;
    text?: string;
    html?: string;
  } = {
    to: "person@example.com",
    subject: "CANARY_SUBJECT",
    text: "CANARY_BODY",
  },
) {
  return client.callTool({
    name: "email_validate",
    arguments: arguments_,
  });
}

function structured(result: { structuredContent?: unknown }) {
  return result.structuredContent as Record<string, unknown>;
}
