// Relative imports (not "@/..."): vite.config.ts imports this module at config
// time to prerender the compare routes, where tsconfig path aliases don't resolve.
import fieldSupport from "./field-support.generated.json";
import { type Provider, providers } from "./providers";

export const messageFields = [
  "cc",
  "bcc",
  "replyTo",
  "headers",
  "attachments",
  "tags",
  "metadata",
  "sendAt",
] as const;

export type MessageField = (typeof messageFields)[number];

export const messageFieldLabels: Record<MessageField, string> = {
  cc: "CC recipients",
  bcc: "BCC recipients",
  replyTo: "Reply-To address",
  headers: "Custom headers",
  attachments: "Attachments",
  tags: "Tags",
  metadata: "Metadata",
  sendAt: "Scheduled sending (sendAt)",
};

export type ProviderKey = keyof typeof fieldSupport;

export function getFieldSupport(key: ProviderKey): Partial<Record<MessageField, boolean>> {
  return fieldSupport[key];
}

export function getProvider(key: ProviderKey): Provider {
  const provider = providers.find((entry) => entry.key === key);
  if (!provider) throw new Error(`Unknown provider key: ${key}`);
  return provider;
}

/**
 * Fields that are lost when failing over from `from` to `to` — exactly what
 * assertSupportedMessageFields rejects on the fallback adapter. This is the
 * SDK's own compatibility data, surfaced for comparison pages.
 */
export function getFallbackGaps(from: ProviderKey, to: ProviderKey): MessageField[] {
  const fromSupport = getFieldSupport(from);
  const toSupport = getFieldSupport(to);
  return messageFields.filter((field) => fromSupport[field] && !toSupport[field]);
}

export type ComparePair = {
  slug: string;
  a: ProviderKey;
  b: ProviderKey;
  /**
   * Hand-written, pair-specific intro (>=120 words). Never templated — this is
   * what keeps the pages from being thin programmatic content.
   */
  intro: string;
};

export const comparePairs: ComparePair[] = [
  {
    slug: "resend-vs-postmark",
    a: "resend",
    b: "postmark",
    intro:
      "Resend and Postmark are both developer-first transactional email APIs, but they grew up in different eras. Postmark has spent over a decade earning a reputation for fast, reliable inbox delivery and strict separation of transactional and broadcast streams, which makes it a favorite for password resets, receipts, and other must-arrive mail. Resend is the newer entrant, built by the team behind React Email, and wins on developer experience: a modern dashboard, first-class React templates, and quick domain setup. In the message model the practical differences show up at the edges — Resend supports scheduled sending natively while Postmark does not, and Postmark exposes structured metadata on each message while Resend leans on tags. Both handle CC, BCC, reply-to, custom headers, and attachments without fuss.",
  },
  {
    slug: "resend-vs-sendgrid",
    a: "resend",
    b: "sendgrid",
    intro:
      "SendGrid (now part of Twilio) is the incumbent of transactional email: it has been around since 2009, handles enormous volume, and its v3 Mail Send API covers nearly every feature a sender could ask for — including per-message metadata and scheduled sends. That maturity comes with a sprawling dashboard, IP-reputation management you may need to do yourself on shared pools, and a pricing ladder that can surprise you as volume grows. Resend is the opposite trade: a small, sharp API with excellent defaults, React Email templates, and a fast path from signup to first send, at the cost of fewer enterprise controls. On the message shape itself the two are nearly equivalent; SendGrid's extra metadata field support is the only structural difference the SDK has to reconcile.",
  },
  {
    slug: "resend-vs-ses",
    a: "resend",
    b: "ses",
    intro:
      "Amazon SES is the cheapest way to send email at scale — fractions of a cent per message — and it sits inside the AWS ecosystem you may already run on, with IAM auth, CloudWatch metrics, and regional endpoints. The trade-off is that SES is infrastructure, not a product: you manage your own sending reputation, configuration sets, and bounce handling, and the console is unmistakably AWS. Resend is a managed product with opinionated defaults, a clean dashboard, and React Email support, priced per-message at a premium over raw SES. In the unified message model the gap is scheduling and structured data: Resend supports sendAt natively while SES has no scheduled-send API, and neither exposes per-message metadata, so both lean on tags for categorization.",
  },
  {
    slug: "resend-vs-mailgun",
    a: "resend",
    b: "mailgun",
    intro:
      "Mailgun was one of the original developer email APIs and it still shows: flexible routing, inbound parsing, EU and US regions, and a message API that supports everything in the unified shape — CC, BCC, headers, attachments, tags, metadata, and scheduled delivery. It is a strong pick when you need inbound mail or regional data residency alongside outbound sends. Resend is younger and more focused: outbound transactional email with a polished developer experience, React Email templates, and a simpler pricing page, but no per-message metadata field and no inbound handling. If your application round-trips structured data on every message, Mailgun's metadata support matters; if your priority is shipping the first send this afternoon, Resend's onboarding is hard to beat, and the SDK keeps a later migration to a single-line change.",
  },
  {
    slug: "resend-vs-loops",
    a: "resend",
    b: "loops",
    intro:
      "Resend and Loops both target modern SaaS teams but solve different problems. Resend is a transactional email API in the classic sense: you construct a message — recipients, subject, HTML, attachments — and it delivers it, with scheduling, tags, and full header control. Loops is an email platform for product companies where transactional sends are one feature next to marketing loops and audience management; its transactional API is intentionally minimal and template-driven, so the unified message shape maps onto a much smaller surface — no CC or BCC, no custom headers, no tags, and no scheduled sending, though it does carry per-message metadata (data variables) and attachments. Pick Loops when the same tool should own lifecycle and marketing email; pick Resend when you want a full-fidelity send API.",
  },
  {
    slug: "resend-vs-mailersend",
    a: "resend",
    b: "mailersend",
    intro:
      "MailerSend is the transactional arm of the MailerLite family, and it inherits that lineage: a generous free tier, a template gallery with a drag-and-drop editor, and team-friendly features like domain-level permissions that appeal to mixed marketing-and-engineering orgs. Its API covers the full common surface — CC, BCC, reply-to, headers, attachments, tags, and scheduled sending — making it structurally one of the closest matches to Resend in the SDK's capability matrix; neither exposes per-message metadata. Resend differentiates on developer experience instead: React Email integration, a minimal API, and fast domain verification. Costs diverge with volume and features, so the practical decision is usually whether you want MailerSend's built-in template tooling or prefer owning templates in code with Resend and React Email.",
  },
  {
    slug: "postmark-vs-sendgrid",
    a: "postmark",
    b: "sendgrid",
    intro:
      "Postmark and SendGrid are the classic head-to-head of transactional email. Postmark's pitch is focus: transactional mail only (broadcasts live on a separate stream), consistently fast inbox delivery, 45 days of full-content message history, and pricing that is simple if never the cheapest. SendGrid's pitch is breadth: one platform for transactional and marketing email, dedicated IP options, subusers for multi-tenant setups, and an API that has accumulated every feature over fifteen years — including native scheduled sending, which Postmark lacks. Both support CC, BCC, reply-to, custom headers, attachments, tags, and per-message metadata in the unified message shape, so switching between them with the SDK is nearly lossless; only scheduled sends need a migration plan when moving from SendGrid to Postmark, and the SDK's field checks will flag exactly that.",
  },
  {
    slug: "postmark-vs-mailgun",
    a: "postmark",
    b: "mailgun",
    intro:
      "Postmark and Mailgun both come from the developer-tools generation of email providers, but they optimize for different things. Postmark optimizes for deliverability and clarity: separate transactional and broadcast message streams, aggressive list hygiene, detailed delivery events, and a UI your support team can actually use. Mailgun optimizes for flexibility: powerful routing and inbound parsing, EU region hosting for data residency, send-time optimization, and native scheduled delivery — the one field in the unified message shape Postmark doesn't support. Both carry CC, BCC, reply-to, headers, attachments, tags, and metadata, so the SDK can fail over between them for most messages. Teams typically choose Postmark for critical low-volume transactional mail and Mailgun when inbound processing or EU residency is a requirement — or run both, with one as the fallback route.",
  },
  {
    slug: "postmark-vs-ses",
    a: "postmark",
    b: "ses",
    intro:
      "Postmark and Amazon SES sit at opposite ends of the managed-vs-infrastructure spectrum. Postmark is a premium managed service: you pay per message for excellent deliverability out of the box, human support, and a dashboard with full message history — a strong default for teams that want transactional email to be someone else's operational problem. SES is a raw sending engine priced near cost; deliverability is largely yours to manage through dedicated IPs, configuration sets, and bounce processing, which rewards teams with the volume to justify the effort. In the unified message model Postmark's structured metadata has no SES equivalent, while neither offers native scheduled sending. The SDK's fail-fast checks flag metadata before a Postmark-to-SES fallback silently drops it, so the cost gap can be exploited without losing data integrity.",
  },
  {
    slug: "sendgrid-vs-mailgun",
    a: "sendgrid",
    b: "mailgun",
    intro:
      "SendGrid and Mailgun are the two heavyweight generalists of email infrastructure, and on the unified message shape they are actually identical: both support every field the SDK models — CC, BCC, reply-to, custom headers, attachments, tags, metadata, and scheduled sending — which makes them fully interchangeable as fallbacks for each other. The decision therefore comes down to the platforms around the API. SendGrid brings Twilio-scale infrastructure, marketing campaigns in the same account, subusers, and granular IP management. Mailgun counters with stronger inbound mail processing, straightforward EU data residency, message retention options, and a reputation for developer-friendly logs and webhooks. Pricing at low volume is comparable; at high volume both reward negotiation, so benchmark real traffic — ideally through the SDK, where swapping the adapter is one line — before committing either way.",
  },
  {
    slug: "sendgrid-vs-ses",
    a: "sendgrid",
    b: "ses",
    intro:
      "SendGrid versus Amazon SES is usually a cost-versus-convenience decision. SES wins on raw price by an order of magnitude and integrates natively with IAM, CloudWatch, and the rest of AWS — if your infrastructure already lives there, sending through SES keeps billing and auth in one place. What SES does not give you is a product: no template marketing tools, minimal UI, and deliverability management is your job. SendGrid charges more per message but bundles IP management, marketing email, template editing, and analytics into one platform. In the message model SendGrid supports per-message metadata and native scheduled sending; SES supports neither, so the SDK's field-support checks matter when SES is your fallback — tags are the only categorization that survives the hop.",
  },
  {
    slug: "sendgrid-vs-brevo",
    a: "sendgrid",
    b: "brevo",
    intro:
      "SendGrid and Brevo (formerly Sendinblue) both bundle transactional and marketing email into one platform, and both support the entire unified message shape — CC, BCC, reply-to, headers, attachments, tags, metadata, and scheduled sending — so with the SDK they are drop-in replacements for each other at the API level. The differences are commercial and regional. Brevo is European, GDPR-native, and prices by messages sent rather than contacts stored, with a workable free tier that makes it popular with early-stage teams; it also folds in SMS, WhatsApp, and a CRM. SendGrid is the larger sender with deeper deliverability tooling, dedicated IP options, and Twilio's enterprise support behind it. For EU-heavy audiences Brevo's regional footing is a genuine advantage; for very high volume SendGrid's infrastructure usually wins.",
  },
  {
    slug: "mailgun-vs-ses",
    a: "mailgun",
    b: "ses",
    intro:
      "Mailgun and Amazon SES both court high-volume senders, but with different bargains. SES offers the lowest unit price in the industry and rock-solid infrastructure, in exchange for doing your own deliverability work: warming IPs, processing bounces via SNS, and living without much of a UI. Mailgun costs more per message but includes the operational layer — send-time optimization, inbound routing and parsing, EU region hosting, searchable logs, and human support tiers. The unified message shape exposes a real functional gap too: Mailgun supports per-message metadata and native scheduled delivery while SES supports neither, so a Mailgun-to-SES fallback drops both fields and the SDK will fail fast rather than lose them silently. Teams often start on Mailgun and graduate to SES when volume justifies the operational investment.",
  },
  {
    slug: "brevo-vs-mailersend",
    a: "brevo",
    b: "mailersend",
    intro:
      "Brevo and MailerSend are both European-rooted platforms that pair transactional APIs with approachable marketing tooling, which makes them a common shortlist for teams that want one vendor for both jobs. Brevo is the broader suite: campaigns, automation, SMS, WhatsApp, and a CRM alongside its SMTP and API sending, priced by send volume with a usable free tier. MailerSend is narrower and more developer-focused within the MailerLite family, with a clean REST API, template editor, and inbound routing. In the unified message shape they differ on exactly one field: Brevo supports per-message metadata while MailerSend does not — both handle CC, BCC, reply-to, headers, attachments, tags, and scheduled sending — so failing over from Brevo to MailerSend only needs care when messages carry metadata.",
  },
];

/**
 * Real constructor arguments per adapter (they differ: Postmark takes a server
 * token, SES takes IAM credentials, Loops needs a template id), so the code
 * snippets on comparison pages compile as written.
 */
export const adapterConfigSnippets: Partial<Record<ProviderKey, string>> = {
  resend: `resend({ apiKey: process.env.RESEND_API_KEY! })`,
  postmark: `postmark({ serverToken: process.env.POSTMARK_SERVER_TOKEN! })`,
  sendgrid: `sendgrid({ apiKey: process.env.SENDGRID_API_KEY! })`,
  ses: `ses({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    region: "us-east-1",
  })`,
  mailgun: `mailgun({ apiKey: process.env.MAILGUN_API_KEY!, domain: "mg.yourdomain.com" })`,
  brevo: `brevo({ apiKey: process.env.BREVO_API_KEY! })`,
  mailersend: `mailersend({ apiKey: process.env.MAILERSEND_API_KEY! })`,
  loops: `loops({
    apiKey: process.env.LOOPS_API_KEY!,
    transactionalId: "your-template-id",
  })`,
};

export function getAdapterConfigSnippet(key: ProviderKey): string {
  return adapterConfigSnippets[key] ?? `${key}({ apiKey: process.env.EMAIL_API_KEY! })`;
}

export function getComparePair(slug: string): ComparePair | undefined {
  return comparePairs.find((pair) => pair.slug === slug);
}

export function getComparePairsForProvider(key: ProviderKey): ComparePair[] {
  return comparePairs.filter((pair) => pair.a === key || pair.b === key);
}

export function getComparePairTitle(pair: ComparePair): string {
  return `${getProvider(pair.a).name} vs ${getProvider(pair.b).name}`;
}
