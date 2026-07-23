import {
  EmailProviderError,
  EmailProviderNotFoundError,
  createEmailClient,
  type EmailClient,
  type EmailClientOptions,
  type EmailMessage,
  type EmailPlugin,
  type EmailProvider,
  type EmailProviderContext,
  type EmailProviderResponse,
  type SendBatchItem,
  type SendBatchResult,
  type SendOptions,
} from "../src/compat.js";

const provider: EmailProvider = {
  name: "legacy",
  send(_message: EmailMessage, _context: EmailProviderContext): EmailProviderResponse {
    return { provider: "legacy", messageId: "legacy_1" };
  },
};

const plugin = {
  id: "legacy-plugin",
  extendClient() {
    return { legacyExtension: true as const };
  },
} satisfies EmailPlugin<{ legacyExtension: true }>;

const options: EmailClientOptions<[typeof plugin]> = {
  providers: [provider],
  defaultProvider: "legacy",
  fallback: [],
  retry: { retries: 2 },
  hooks: {
    beforeSend(event) {
      event.provider.toUpperCase();
    },
  },
  plugins: [plugin],
};
const client: EmailClient<{ legacyExtension: true }> = createEmailClient(options);
const sendOptions: SendOptions = { provider: "legacy", retries: 1 };
const batch: SendBatchItem[] = [
  {
    from: "hello@example.com",
    to: "user@example.com",
    subject: "Hello",
    text: "Hello",
    recipientVariables: { "user@example.com": { name: "Ada" } },
  },
];

const response: Promise<EmailProviderResponse> = client.send(batch[0]!, sendOptions);
const batchResponse: Promise<SendBatchResult[]> = client.sendBatch(batch, sendOptions);
const legacyExtension: true = client.legacyExtension;
new EmailProviderError("failed", { provider: "legacy" });
new EmailProviderNotFoundError("legacy");
void response;
void batchResponse;
void legacyExtension;
