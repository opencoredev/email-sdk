import { cloudflare } from "../src/cloudflare.js";
import { createEmailClient } from "../src/index.js";
import type { EmailAdapter, EmailHookEvent, EmailMessage } from "../src/index.js";
import { smtp } from "../src/smtp.js";
import { normalizeWebhookEvent, verifyMailgunWebhook, verifyResendWebhook } from "../src/webhooks.js";
import type { NormalizedWebhookEvent, WebhookDeliveryStatus } from "../src/webhooks.js";

const verifiedWebhook: Promise<boolean> = verifyResendWebhook({
  body: "{}", headers: new Headers(), secret: ["current", "previous"], now: Date.now(), toleranceSeconds: 300,
});
const verifiedMailgun: Promise<boolean> = verifyMailgunWebhook({ body: "{}", secret: "signing-key", signatureField: "parent-signature" });
const normalizedWebhook: Promise<NormalizedWebhookEvent> = normalizeWebhookEvent({ provider: "resend", body: "{}" });
normalizedWebhook.then(event => {
  const status: WebhookDeliveryStatus | undefined = event.status;
  void status;
});
void verifiedWebhook;
void verifiedMailgun;
// @ts-expect-error sending adapters are not necessarily supported webhook normalizers
normalizeWebhookEvent({ provider: "smtp", body: "{}" });
// @ts-expect-error verification helpers are not exported from the root
import { verifyResendWebhook as rootWebhookVerifier } from "../src/index.js";
void rootWebhookVerifier;

const primary: EmailAdapter<"primary"> = {
  name: "primary",
  capabilities: {
    repeatedHeaders: true,
    idempotency: "native",
    scheduling: true,
    personalized: "expanded",
  },
  send() {
    return { adapter: "primary" };
  },
};

const backup = smtp({ name: "backup", host: "smtp.example.com" });
const client = createEmailClient({
  adapters: [primary, backup],
  defaultAdapter: "primary",
  fallback: { adapters: ["backup"] },
});

client.adapter("primary");
client.adapter("backup");
client.withAdapter("backup");
client.validate({
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Hello",
  text: "Hello",
});
client.send(
  {
    from: "hello@example.com",
    to: "user@example.com",
    subject: "Hello",
    text: "Hello",
  },
  { adapter: "backup" },
);

// @ts-expect-error unknown routes are rejected
client.adapter("missing");
// @ts-expect-error unsafe caller-selected adapter generic assertions are rejected
client.adapter<typeof primary>("primary");
// @ts-expect-error provider vocabulary is absent from the v1 root send options
client.send({ from: "a", to: "b", subject: "c", text: "d" }, { provider: "primary" });

// @ts-expect-error a message requires text, html, or both
const missingBody: EmailMessage = {
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Hello",
};
void missingBody;

const validAttachment: EmailMessage = {
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Hello",
  text: "Hello",
  attachments: [{ filename: "hello.txt", content: "hello" }],
};
void validAttachment;

const invalidBothSources: EmailMessage = {
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Hello",
  text: "Hello",
  attachments: [
    // @ts-expect-error attachments have exactly one source
    { filename: "hello.txt", content: "hello", path: "./hello.txt" },
  ],
};
void invalidBothSources;

const invalidNoSource: EmailMessage = {
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Hello",
  text: "Hello",
  attachments: [
    // @ts-expect-error attachments require content or path
    { filename: "hello.txt" },
  ],
};
void invalidNoSource;

const hookEvent: EmailHookEvent = {
  adapter: "primary",
  attempt: 1,
  message: validAttachment,
};
void hookEvent;

type GeneratedCloudflareEmailAddress = string | { email: string; name: string };
type GeneratedCloudflareAttachment =
  | {
      disposition: "inline";
      contentId: string;
      filename: string;
      type: string;
      content: string | ArrayBuffer | ArrayBufferView;
    }
  | {
      disposition: "attachment";
      contentId?: undefined;
      filename: string;
      type: string;
      content: string | ArrayBuffer | ArrayBufferView;
    };
type GeneratedCloudflareMessage = {
  from: GeneratedCloudflareEmailAddress;
  to: GeneratedCloudflareEmailAddress | GeneratedCloudflareEmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  cc?: GeneratedCloudflareEmailAddress | GeneratedCloudflareEmailAddress[];
  bcc?: GeneratedCloudflareEmailAddress | GeneratedCloudflareEmailAddress[];
  replyTo?: GeneratedCloudflareEmailAddress;
  attachments?: GeneratedCloudflareAttachment[];
  headers?: Record<string, string>;
};
type GeneratedCloudflareSendEmail = {
  send(message: { readonly from: string; readonly to: string }): Promise<{ messageId: string }>;
  send(message: GeneratedCloudflareMessage): Promise<{ messageId: string }>;
};
declare const generatedCloudflareBinding: GeneratedCloudflareSendEmail;
cloudflare({ binding: generatedCloudflareBinding });

// @ts-expect-error the v1 root does not export legacy provider types
import type { EmailProvider } from "../src/index.js";
void (undefined as unknown as EmailProvider);

// @ts-expect-error internal plugin type machinery is not part of the v1 root
import type { UnionToIntersection } from "../src/index.js";
void (undefined as unknown as UnionToIntersection<unknown>);
