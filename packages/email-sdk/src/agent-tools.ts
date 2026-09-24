import type { JsonObject } from "./internal/decode.js";

import type { EmailClient, EmailMessage, EmailSendResult } from "./types.js";

export type { JsonObject, JsonValue } from "./internal/decode.js";

export type EmailAgentTool = {
  name: string;
  description: string;
  /** JSON Schema describing the tool input. */
  parameters: JsonObject;
  execute(input: EmailMessage & { adapter?: string; provider?: string }): Promise<EmailSendResult>;
};

export type EmailAgentTools = {
  sendEmail: EmailAgentTool;
};

export function createEmailAgentTools(client: EmailClient): EmailAgentTools {
  return {
    sendEmail: {
      name: "send_email",
      description:
        "Send one transactional email through Email SDK. Ask for confirmation before sending user-visible or external email.",
      parameters: {
        type: "object",
        required: ["from", "to", "subject"],
        properties: {
          from: { type: "string" },
          to: {
            oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
          subject: { type: "string" },
          html: { type: "string" },
          text: { type: "string" },
          adapter: { type: "string" },
          provider: { type: "string" },
        },
      },
      async execute(input) {
        const { adapter, provider, ...message } = input;
        const selectedAdapter = adapter ?? provider;

        return client.send(message, selectedAdapter ? { adapter: selectedAdapter } : undefined);
      },
    },
  };
}
