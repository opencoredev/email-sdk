import { describe, expect, test } from "bun:test";
import { asSchema, generateText } from "ai";
import type { ModelMessage, ToolApprovalResponse, ToolExecutionOptions } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import { createEmailTools, emailToolApproval } from "./ai.js";
import type { EmailClient, EmailMessage, SendOptions } from "./types.js";

type SendCall = {
  message: EmailMessage;
  options?: SendOptions;
};

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

function modelForEmailCall(input: Record<string, unknown> = {}) {
  return new MockLanguageModelV4({
    doGenerate: [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "call_email_1",
            toolName: "sendEmail",
            input: JSON.stringify({
              to: "user@example.com",
              subject: "Welcome",
              text: "Hello",
              ...input,
            }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: undefined },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "Email handled." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });
}

function recordingClient(
  result: { adapter: string; id?: string } = { adapter: "recording", id: "msg_1" },
) {
  const calls: SendCall[] = [];
  const client = {
    async send(message: EmailMessage, options?: SendOptions) {
      calls.push({ message, options });
      return result;
    },
  } satisfies Pick<EmailClient, "send">;

  return { calls, client };
}

function executionOptions(
  overrides: Partial<ToolExecutionOptions<unknown>> = {},
): ToolExecutionOptions<unknown> {
  return {
    toolCallId: "call_1",
    messages: [],
    context: undefined,
    ...overrides,
  };
}

describe("createEmailTools", () => {
  test("exposes the approval policy and a closed input schema", () => {
    const { client } = recordingClient();
    const email = createEmailTools({ client, from: "sender@example.com" });

    expect(email.toolApproval).toEqual(emailToolApproval);
    expect(email.toolApproval).toEqual({ sendEmail: "user-approval" });
    expect(email.tools.sendEmail.needsApproval).toBe(true);
    expect(asSchema(email.tools.sendEmail.inputSchema).jsonSchema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["to", "subject"],
      properties: {
        to: {
          oneOf: [
            { type: "string", minLength: 1 },
            {
              type: "array",
              minItems: 1,
              items: { type: "string", minLength: 1 },
            },
          ],
        },
        subject: { type: "string", minLength: 1 },
        text: { type: "string", minLength: 1 },
        html: { type: "string", minLength: 1 },
      },
      anyOf: [{ required: ["text"] }, { required: ["html"] }],
    });
  });

  test("rejects missing bodies and every excluded field at runtime", async () => {
    const { client } = recordingClient();
    const email = createEmailTools({ client, from: "sender@example.com" });
    const validate = asSchema(email.tools.sendEmail.inputSchema).validate;
    if (!validate) throw new Error("Expected sendEmail input validation.");

    expect(await validate({ to: "user@example.com", subject: "Missing body" })).toMatchObject({
      success: false,
    });

    const excludedFields = [
      "from",
      "adapter",
      "provider",
      "fallback",
      "fallbackAdapters",
      "fallbackProviders",
      "retry",
      "retries",
      "headers",
      "metadata",
      "idempotencyKey",
      "sendAt",
      "attachments",
      "cc",
      "bcc",
      "replyTo",
      "tags",
      "recipientVariables",
    ];
    for (const field of excludedFields) {
      expect(
        await validate({
          to: "user@example.com",
          subject: "Welcome",
          text: "Hello",
          [field]: "model-controlled",
        }),
      ).toMatchObject({ success: false });
    }

    expect(
      await validate({
        to: "user@example.com",
        subject: "Welcome",
        html: "<p>Hello</p>",
      }),
    ).toMatchObject({ success: true });
  });

  test("binds the sender and forwards safe execution metadata", async () => {
    const { calls, client } = recordingClient();
    const email = createEmailTools({ client, from: "Acme <sender@example.com>" });
    const abortController = new AbortController();

    const output = await email.tools.sendEmail.execute?.(
      {
        to: ["one@example.com", "two@example.com"],
        subject: "Welcome",
        text: "Plain text",
        html: "<p>HTML</p>",
      },
      executionOptions({ abortSignal: abortController.signal, toolCallId: "call_email_1" }),
    );

    expect(output).toEqual({ status: "sent", adapter: "recording", id: "msg_1" });
    expect(calls).toEqual([
      {
        message: {
          from: "Acme <sender@example.com>",
          to: ["one@example.com", "two@example.com"],
          subject: "Welcome",
          text: "Plain text",
          html: "<p>HTML</p>",
        },
        options: {
          signal: abortController.signal,
          idempotencyKey: "email-tool:call_email_1",
          metadata: { source: "email-sdk-ai", toolCallId: "call_email_1" },
        },
      },
    ]);
  });

  test("AI SDK 7 waits for top-level approval and sends exactly once after approval", async () => {
    const { calls, client } = recordingClient();
    const email = createEmailTools({ client, from: "sender@example.com" });
    const model = modelForEmailCall();
    const messages: ModelMessage[] = [{ role: "user", content: "Send the welcome email" }];

    const first = await generateText({
      model,
      tools: email.tools,
      toolApproval: email.toolApproval,
      messages,
    });

    expect(calls).toHaveLength(0);
    const request = first.content.find((part) => part.type === "tool-approval-request");
    if (!request || request.type !== "tool-approval-request") {
      throw new Error("Expected an email tool approval request.");
    }

    const approvals: ToolApprovalResponse[] = [
      {
        type: "tool-approval-response",
        approvalId: request.approvalId,
        approved: true,
      },
    ];
    messages.push(...first.responseMessages, { role: "tool", content: approvals });

    const second = await generateText({
      model,
      tools: email.tools,
      toolApproval: email.toolApproval,
      messages,
    });

    expect(second.text).toBe("Email handled.");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.idempotencyKey).toBe("email-tool:call_email_1");
  });

  test("AI SDK 7 rejects invalid input before approval or sending", async () => {
    const { calls, client } = recordingClient();
    const email = createEmailTools({ client, from: "sender@example.com" });
    const model = modelForEmailCall({ text: undefined, cc: "hidden@example.com" });

    const result = await generateText({
      model,
      tools: email.tools,
      toolApproval: email.toolApproval,
      prompt: "Send an invalid email",
    });

    expect(calls).toHaveLength(0);
    expect(result.content.some((part) => part.type === "tool-error")).toBe(true);
    expect(result.content.some((part) => part.type === "tool-approval-request")).toBe(false);
  });

  test("AI SDK 7 denial is terminal and never sends", async () => {
    const { calls, client } = recordingClient();
    const email = createEmailTools({ client, from: "sender@example.com" });
    const model = modelForEmailCall();
    const messages: ModelMessage[] = [{ role: "user", content: "Send the welcome email" }];

    const first = await generateText({
      model,
      tools: email.tools,
      toolApproval: email.toolApproval,
      messages,
    });
    const request = first.content.find((part) => part.type === "tool-approval-request");
    if (!request || request.type !== "tool-approval-request") {
      throw new Error("Expected an email tool approval request.");
    }

    messages.push(...first.responseMessages, {
      role: "tool",
      content: [
        {
          type: "tool-approval-response",
          approvalId: request.approvalId,
          approved: false,
          reason: "Wrong recipient",
        },
      ],
    });

    await generateText({
      model,
      tools: email.tools,
      toolApproval: email.toolApproval,
      messages,
    });

    expect(calls).toHaveLength(0);
  });

  test("omits absent receipt ids from the allowlisted output", async () => {
    const { client } = recordingClient({ adapter: "recording" });
    const email = createEmailTools({ client, from: "sender@example.com" });

    const output = await email.tools.sendEmail.execute?.(
      { to: "user@example.com", subject: "Welcome", text: "Hello" },
      executionOptions(),
    );

    expect(output).toEqual({ status: "sent", adapter: "recording" });
  });

  test("does not expose raw responses or recipient delivery details", async () => {
    const client = {
      async send() {
        return {
          adapter: "recording",
          id: "msg_1",
          accepted: ["user@example.com"],
          rejected: ["other@example.com"],
          raw: { secret: "provider payload" },
        };
      },
    } satisfies Pick<EmailClient, "send">;
    const email = createEmailTools({ client, from: "sender@example.com" });

    const output = await email.tools.sendEmail.execute?.(
      { to: "user@example.com", subject: "Welcome", text: "Hello" },
      executionOptions(),
    );

    expect(output).toEqual({ status: "sent", adapter: "recording", id: "msg_1" });
  });

  test("replaces adapter failures with a content-safe error", async () => {
    const client = {
      async send() {
        throw new Error("secret provider response with user@example.com");
      },
    } satisfies Pick<EmailClient, "send">;
    const email = createEmailTools({ client, from: "sender@example.com" });

    await expect(
      email.tools.sendEmail.execute?.(
        { to: "user@example.com", subject: "Welcome", text: "Hello" },
        executionOptions(),
      ),
    ).rejects.toThrow("Email could not be sent.");
  });

  test("preserves abort errors instead of turning cancellation into a tool failure", async () => {
    const abortController = new AbortController();
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    abortController.abort(abortError);
    const client = {
      async send() {
        throw new Error("adapter work stopped");
      },
    } satisfies Pick<EmailClient, "send">;
    const email = createEmailTools({ client, from: "sender@example.com" });

    await expect(
      email.tools.sendEmail.execute?.(
        { to: "user@example.com", subject: "Welcome", text: "Hello" },
        executionOptions({ abortSignal: abortController.signal }),
      ),
    ).rejects.toBe(abortError);
  });

  test("AI SDK 7 projects adapter failures without leaking provider data", async () => {
    const client = {
      async send() {
        throw new Error("secret raw provider payload for user@example.com");
      },
    } satisfies Pick<EmailClient, "send">;
    const email = createEmailTools({ client, from: "sender@example.com" });
    const model = modelForEmailCall();
    const messages: ModelMessage[] = [{ role: "user", content: "Send the welcome email" }];

    const first = await generateText({
      model,
      tools: email.tools,
      toolApproval: email.toolApproval,
      messages,
    });
    const request = first.content.find((part) => part.type === "tool-approval-request");
    if (!request || request.type !== "tool-approval-request") {
      throw new Error("Expected an email tool approval request.");
    }

    messages.push(...first.responseMessages, {
      role: "tool",
      content: [
        {
          type: "tool-approval-response",
          approvalId: request.approvalId,
          approved: true,
        },
      ],
    });

    const second = await generateText({
      model,
      tools: email.tools,
      toolApproval: email.toolApproval,
      messages,
    });
    const serialized = JSON.stringify(second.responseMessages);

    expect(serialized).toContain("Email could not be sent.");
    expect(serialized).not.toContain("secret raw provider payload");
    expect(serialized).not.toContain("user@example.com");
  });
});
