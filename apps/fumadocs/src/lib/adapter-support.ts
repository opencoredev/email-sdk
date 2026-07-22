export const ADAPTER_SUPPORT_FIELDS = [
  "cc",
  "bcc",
  "replyTo",
  "headers",
  "attachments",
  "tags",
  "metadata",
  "sendAt",
] as const;

export type AdapterSupportField = (typeof ADAPTER_SUPPORT_FIELDS)[number];

export type AdapterSupportCapabilities = {
  repeatedHeaders: boolean;
  idempotency: "native" | "message_id" | "none";
  scheduling: boolean;
  personalized: "native" | "expanded";
};

export type AdapterSupportEntry = {
  id: string;
  label: string;
  setupHref: string;
  fields: Partial<Record<AdapterSupportField, true>>;
  capabilities: AdapterSupportCapabilities;
  limits?: readonly string[];
};

export const ADAPTER_SUPPORT_ENTRIES = [
  {
    id: "resend",
    label: "Resend",
    setupHref: "/docs/adapters/resend",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true, sendAt: true },
    capabilities: { repeatedHeaders: false, idempotency: "native", scheduling: true, personalized: "expanded" },
  },
  {
    id: "postmark",
    label: "Postmark",
    setupHref: "/docs/adapters/postmark",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true, metadata: true },
    capabilities: { repeatedHeaders: true, idempotency: "none", scheduling: false, personalized: "expanded" },
    limits: ["Accepts one tag and flattens one name:value tag for the provider payload."],
  },
  {
    id: "sendgrid",
    label: "SendGrid",
    setupHref: "/docs/adapters/sendgrid",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true, metadata: true, sendAt: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: true, personalized: "native" },
    limits: ["Native personalized delivery caps one request at 1,000 recipients.", "Tag names are discarded; tag values are sent as categories."],
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    setupHref: "/docs/adapters/cloudflare",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: false, personalized: "expanded" },
    limits: ["Accepts at most 50 combined to, cc, and bcc recipients.", "Recipient display names are not supported; plain strings and {email} objects are valid.", "Accepts one reply-to address."],
  },
  {
    id: "unosend",
    label: "Unosend",
    setupHref: "/docs/adapters/unosend",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: false, personalized: "expanded" },
    limits: ["Accepts one reply-to address."],
  },
  {
    id: "ses",
    label: "AWS SES",
    setupHref: "/docs/adapters/ses",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true },
    capabilities: { repeatedHeaders: true, idempotency: "none", scheduling: false, personalized: "expanded" },
  },
  {
    id: "mailgun",
    label: "Mailgun",
    setupHref: "/docs/adapters/mailgun",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true, metadata: true, sendAt: true },
    capabilities: { repeatedHeaders: true, idempotency: "none", scheduling: true, personalized: "native" },
    limits: ["Native personalized delivery caps one request at 1,000 recipients.", "Tag names are discarded; tag values are sent as o:tag values."],
  },
  {
    id: "mailersend",
    label: "MailerSend",
    setupHref: "/docs/adapters/mailersend",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true, sendAt: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: true, personalized: "expanded" },
    limits: ["Accepts one reply-to address.", "Tag names are discarded; tag values are sent as tags."],
  },
  {
    id: "brevo",
    label: "Brevo",
    setupHref: "/docs/adapters/brevo",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true, metadata: true, sendAt: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: true, personalized: "expanded" },
    limits: ["Accepts one reply-to address."],
  },
  {
    id: "mailchimp",
    label: "Mailchimp Transactional",
    setupHref: "/docs/adapters/mailchimp",
    fields: { cc: true, bcc: true, headers: true, attachments: true, tags: true, metadata: true, sendAt: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: true, personalized: "expanded" },
    limits: ["Scheduling sends provider UTC strings in yyyy-mm-dd HH:MM:ss grammar."],
  },
  {
    id: "sparkpost",
    label: "SparkPost",
    setupHref: "/docs/adapters/sparkpost",
    fields: { replyTo: true, headers: true, attachments: true, tags: true, metadata: true, sendAt: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: true, personalized: "expanded" },
    limits: ["Scheduling sends provider UTC strings in YYYY-MM-DDTHH:mm:ss±HH:mm grammar."],
  },
  {
    id: "iterable",
    label: "Iterable",
    setupHref: "/docs/adapters/iterable",
    fields: { metadata: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: false, personalized: "expanded" },
    limits: ["Normal send accepts one to recipient."],
  },
  {
    id: "loops",
    label: "Loops",
    setupHref: "/docs/adapters/loops",
    fields: { attachments: true, metadata: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: false, personalized: "expanded" },
    limits: ["Normal send accepts one to recipient."],
  },
  {
    id: "sequenzy",
    label: "Sequenzy",
    setupHref: "/docs/adapters/sequenzy",
    fields: { replyTo: true, attachments: true, metadata: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: false, personalized: "expanded" },
    limits: ["Accepts at most 50 to recipients.", "Accepts one reply-to address."],
  },
  {
    id: "jetemail",
    label: "JetEmail",
    setupHref: "/docs/adapters/jetemail",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true },
    capabilities: { repeatedHeaders: false, idempotency: "native", scheduling: false, personalized: "expanded" },
    limits: ["Requires a from display name.", "Accepts at most 50 to, 50 cc, 50 bcc, and 50 reply-to addresses."],
  },
  {
    id: "lettermint",
    label: "Lettermint",
    setupHref: "/docs/adapters/lettermint",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true, metadata: true },
    capabilities: { repeatedHeaders: false, idempotency: "native", scheduling: false, personalized: "expanded" },
    limits: ["Accepts one tag."],
  },
  {
    id: "primitive",
    label: "Primitive",
    setupHref: "/docs/adapters/primitive",
    fields: { attachments: true },
    capabilities: { repeatedHeaders: false, idempotency: "native", scheduling: false, personalized: "expanded" },
    limits: ["Normal send accepts one to recipient."],
  },
  {
    id: "plunk",
    label: "Plunk",
    setupHref: "/docs/adapters/plunk",
    fields: { replyTo: true, headers: true, attachments: true, metadata: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: false, personalized: "expanded" },
    limits: ["Accepts one reply-to address."],
  },
  {
    id: "mailtrap",
    label: "Mailtrap",
    setupHref: "/docs/adapters/mailtrap",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true, metadata: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: false, personalized: "expanded" },
    limits: ["Accepts one tag.", "Accepts one reply-to address."],
  },
  {
    id: "scaleway",
    label: "Scaleway",
    setupHref: "/docs/adapters/scaleway",
    fields: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true },
    capabilities: { repeatedHeaders: true, idempotency: "none", scheduling: false, personalized: "expanded" },
    limits: ["Rejects replyTo when headers already include Reply-To."],
  },
  {
    id: "zeptomail",
    label: "ZeptoMail",
    setupHref: "/docs/adapters/zeptomail",
    fields: { cc: true, bcc: true, replyTo: true, attachments: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: false, personalized: "expanded" },
  },
  {
    id: "mailpace",
    label: "MailPace",
    setupHref: "/docs/adapters/mailpace",
    fields: { cc: true, bcc: true, replyTo: true },
    capabilities: { repeatedHeaders: false, idempotency: "none", scheduling: false, personalized: "expanded" },
  },
  {
    id: "smtp",
    label: "SMTP",
    setupHref: "/docs/adapters/smtp",
    fields: { cc: true, bcc: true, replyTo: true, headers: true },
    capabilities: { repeatedHeaders: true, idempotency: "message_id", scheduling: false, personalized: "expanded" },
    limits: ["Validates ASCII envelope addresses and header names before opening a connection."],
  },
] as const satisfies readonly AdapterSupportEntry[];

export const ADAPTER_SUPPORT_TOTAL_LABEL = "22 provider APIs plus SMTP, 23 adapters total";

export function getUnsupportedFields(entry: AdapterSupportEntry): AdapterSupportField[] {
  return ADAPTER_SUPPORT_FIELDS.filter((field) => entry.fields[field] !== true);
}
