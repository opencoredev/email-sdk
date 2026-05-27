import type { EmailClient, EmailMessage } from "./types.js";

export type EmailAgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: EmailMessage & { adapter?: string; provider?: string }): Promise<unknown>;
};

export function createEmailAgentTools(client: EmailClient): { sendEmail: EmailAgentTool } {
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
        return client.send(message, adapter || provider ? { adapter, provider } : undefined);
      },
    },
  };
}
