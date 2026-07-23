import { jsonSchema, tool } from "ai";
import type { Tool } from "ai";

import type { EmailAddress, EmailClient } from "./types.js";

type SendEmailBody = { text: string; html?: string } | { text?: string; html: string };

export type SendEmailInput = {
  to: string | string[];
  subject: string;
} & SendEmailBody;

export type SendEmailOutput = {
  status: "sent";
  adapter: string;
  id?: string;
};

const sendEmailInputSchema = jsonSchema<SendEmailInput>(
  {
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
  },
  {
    validate(value) {
      return isSendEmailInput(value)
        ? { success: true, value }
        : { success: false, error: new Error("Invalid sendEmail tool input.") };
    },
  },
);

const sendEmailInputKeys = new Set(["to", "subject", "text", "html"]);

export const emailToolApproval = {
  sendEmail: "user-approval",
} as const;

type EmailTools = {
  tools: {
    sendEmail: Tool<SendEmailInput, SendEmailOutput>;
  };
  toolApproval: typeof emailToolApproval;
};

export function createEmailTools({
  client,
  from,
}: {
  client: Pick<EmailClient, "send">;
  from: EmailAddress;
}): EmailTools {
  const sendEmail: Tool<SendEmailInput, SendEmailOutput> = tool({
    description:
      "Send one external email after the user reviews the exact recipients, subject, and body.",
    // AI SDK 6 reads tool-level approval. AI SDK 7 callers should also pass the
    // returned toolApproval map to streamText or generateText.
    needsApproval: true,
    inputSchema: sendEmailInputSchema,
    execute: async (input, { abortSignal, toolCallId }) => {
      try {
        const result = await client.send(
          { ...input, from },
          {
            signal: abortSignal,
            idempotencyKey: `email-tool:${toolCallId}`,
            metadata: { source: "email-sdk-ai", toolCallId },
          },
        );

        return {
          status: "sent",
          adapter: result.adapter,
          ...(result.id === undefined ? {} : { id: result.id }),
        } satisfies SendEmailOutput;
      } catch {
        abortSignal?.throwIfAborted();
        throw new Error("Email could not be sent.");
      }
    },
  });

  return {
    tools: { sendEmail },
    toolApproval: emailToolApproval,
  };
}

function isSendEmailInput(value: unknown): value is SendEmailInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  if (Object.keys(value).some((key) => !sendEmailInputKeys.has(key))) return false;

  if (!("to" in value) || !isRecipientInput(value.to)) return false;
  if (!("subject" in value) || !isNonEmptyString(value.subject)) return false;

  const text = "text" in value ? value.text : undefined;
  const html = "html" in value ? value.html : undefined;
  if (text !== undefined && !isNonEmptyString(text)) return false;
  if (html !== undefined && !isNonEmptyString(html)) return false;

  return text !== undefined || html !== undefined;
}

function isRecipientInput(value: unknown): value is string | string[] {
  return (
    isNonEmptyString(value) ||
    (Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
