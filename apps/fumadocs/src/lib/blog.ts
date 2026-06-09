export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  readTime: string;
  image: string;
  imageAlt: string;
  tags: string[];
};

const blogMetaTitleSuffix = " - Email SDK";
const maxBlogMetaTitleLength = 68;

export const blogPosts = [
  {
    slug: "introducing-email-sdk",
    title: "Introducing Email SDK",
    description:
      "Email SDK launched on June 1, 2026: one TypeScript client for transactional email across Resend, SMTP, Postmark, SendGrid, Mailgun, AWS SES, and more.",
    publishedAt: "2026-06-01",
    updatedAt: "2026-06-01",
    readTime: "6 min read",
    image: getBlogPostImageUrl("introducing-email-sdk"),
    imageAlt: "Email SDK unified email sending preview",
    tags: ["Launch", "TypeScript", "Transactional email"],
  },
  {
    slug: "email-provider-fallbacks",
    title: "Email Provider Fallbacks Are a Product Decision",
    description:
      "A practical guide to choosing fallback routes for transactional email without silently dropping message fields.",
    publishedAt: "2026-06-05",
    updatedAt: "2026-06-05",
    readTime: "7 min read",
    image: getBlogPostImageUrl("email-provider-fallbacks"),
    imageAlt: "Email SDK adapter and fallback routing preview",
    tags: ["Reliability", "Adapters", "Email APIs"],
  },
  {
    slug: "nodemailer-alternative-typescript",
    title: "A Nodemailer Alternative for TypeScript Apps",
    description:
      "When to use Nodemailer, when to use a provider API, and why Email SDK keeps SMTP as one route instead of the whole abstraction.",
    publishedAt: "2026-06-10",
    updatedAt: "2026-06-10",
    readTime: "6 min read",
    image: getBlogPostImageUrl("nodemailer-alternative-typescript"),
    imageAlt: "Email SDK TypeScript email provider comparison preview",
    tags: ["Nodemailer", "TypeScript", "SMTP"],
  },
  {
    slug: "transactional-email-provider-checklist",
    title: "A Transactional Email Provider Checklist That Starts With the App",
    description:
      "A practical way to choose Resend, Postmark, SendGrid, Mailgun, SES, SMTP, or a mixed provider setup without turning every email into vendor glue.",
    publishedAt: "2026-06-17",
    updatedAt: "2026-06-17",
    readTime: "8 min read",
    image: getBlogPostImageUrl("transactional-email-provider-checklist"),
    imageAlt: "Checklist for choosing transactional email providers",
    tags: ["Provider selection", "Transactional email", "Architecture"],
  },
  {
    slug: "resend-postmark-sendgrid-comparison",
    title: "Resend, Postmark, and SendGrid Are Different Tools",
    description:
      "A developer-focused comparison of three common transactional email providers, with the tradeoffs that matter once the first welcome email works.",
    publishedAt: "2026-06-24",
    updatedAt: "2026-06-24",
    readTime: "8 min read",
    image: getBlogPostImageUrl("resend-postmark-sendgrid-comparison"),
    imageAlt: "Resend Postmark and SendGrid comparison map",
    tags: ["Resend", "Postmark", "SendGrid"],
  },
  {
    slug: "sendgrid-alternative-typescript",
    title: "Looking for a SendGrid Alternative in a TypeScript App?",
    description:
      "How to move SendGrid-specific code behind a typed email layer so the next provider change does not become a product rewrite.",
    publishedAt: "2026-07-01",
    updatedAt: "2026-07-01",
    readTime: "7 min read",
    image: getBlogPostImageUrl("sendgrid-alternative-typescript"),
    imageAlt: "SendGrid alternative TypeScript adapter route",
    tags: ["SendGrid", "Migration", "TypeScript"],
  },
  {
    slug: "postmark-alternative-typescript",
    title: "A Postmark Alternative Is Usually a Routing Problem",
    description:
      "Postmark is good at transactional email. The hard part is deciding where provider-specific templates, streams, tags, and fallbacks belong.",
    publishedAt: "2026-07-08",
    updatedAt: "2026-07-08",
    readTime: "7 min read",
    image: getBlogPostImageUrl("postmark-alternative-typescript"),
    imageAlt: "Postmark alternative routing diagram",
    tags: ["Postmark", "Routing", "Email APIs"],
  },
  {
    slug: "aws-ses-typescript-production",
    title: "Using AWS SES From TypeScript Without Letting AWS Own the Email Layer",
    description:
      "SES is cheap and serious, but most product teams still need a cleaner app-facing API, safer fallbacks, and sharper provider boundaries.",
    publishedAt: "2026-07-15",
    updatedAt: "2026-07-15",
    readTime: "8 min read",
    image: getBlogPostImageUrl("aws-ses-typescript-production"),
    imageAlt: "AWS SES TypeScript production email architecture",
    tags: ["AWS SES", "TypeScript", "Production"],
  },
  {
    slug: "multi-tenant-email-provider-routing",
    title: "Multi-Tenant Email Routing Needs More Than an ENV Var",
    description:
      "What changes when each tenant can bring a sender domain, provider account, region, or fallback policy into the same TypeScript app.",
    publishedAt: "2026-07-22",
    updatedAt: "2026-07-22",
    readTime: "8 min read",
    image: getBlogPostImageUrl("multi-tenant-email-provider-routing"),
    imageAlt: "Multi-tenant email provider routing lanes",
    tags: ["Multi-tenant", "Routing", "SaaS"],
  },
  {
    slug: "email-fallbacks-without-data-loss",
    title: "Email Fallbacks Without Data Loss",
    description:
      "Fallback email routes can save a login flow or quietly drop metadata. Here is the line between a safe backup and a false sense of safety.",
    publishedAt: "2026-07-29",
    updatedAt: "2026-07-29",
    readTime: "7 min read",
    image: getBlogPostImageUrl("email-fallbacks-without-data-loss"),
    imageAlt: "Transactional email fallback field compatibility",
    tags: ["Fallbacks", "Reliability", "Field support"],
  },
  {
    slug: "smtp-fallback-modern-apps",
    title: "SMTP Is Still a Useful Fallback for Modern Apps",
    description:
      "SMTP should not define your whole email architecture, but it can be a practical backup route when you keep the contract narrow.",
    publishedAt: "2026-08-05",
    updatedAt: "2026-08-05",
    readTime: "7 min read",
    image: getBlogPostImageUrl("smtp-fallback-modern-apps"),
    imageAlt: "SMTP fallback for modern TypeScript apps",
    tags: ["SMTP", "Fallbacks", "Nodemailer"],
  },
  {
    slug: "testing-transactional-email-typescript",
    title: "Testing Transactional Email in TypeScript Without Sending Real Mail",
    description:
      "A straightforward testing strategy for message shape, provider limits, fallback order, and CLI smoke checks.",
    publishedAt: "2026-08-12",
    updatedAt: "2026-08-12",
    readTime: "8 min read",
    image: getBlogPostImageUrl("testing-transactional-email-typescript"),
    imageAlt: "TypeScript transactional email testing workflow",
    tags: ["Testing", "TypeScript", "CLI"],
  },
  {
    slug: "email-observability-provider-adapters",
    title: "Email Observability Starts Before the Provider Dashboard",
    description:
      "Provider dashboards help after the fact. App-level email logs explain which adapter ran, which fields were sent, and why a fallback happened.",
    publishedAt: "2026-08-19",
    updatedAt: "2026-08-19",
    readTime: "7 min read",
    image: getBlogPostImageUrl("email-observability-provider-adapters"),
    imageAlt: "Email adapter observability timeline",
    tags: ["Observability", "Adapters", "Logs"],
  },
  {
    slug: "idempotent-email-retries",
    title: "Email Retries Need an Idempotency Story",
    description:
      "Retries are useful until they send the same receipt twice. The fix starts with message IDs, provider responses, and route-specific failure policy.",
    publishedAt: "2026-08-26",
    updatedAt: "2026-08-26",
    readTime: "7 min read",
    image: getBlogPostImageUrl("idempotent-email-retries"),
    imageAlt: "Idempotent email retry path with message IDs",
    tags: ["Retries", "Reliability", "Idempotency"],
  },
  {
    slug: "adapter-pattern-email-apis",
    title: "The Adapter Pattern Fits Email APIs Better Than a Giant Switch Statement",
    description:
      "A small adapter contract keeps provider quirks local while giving the app one place to send email and one place to check limits.",
    publishedAt: "2026-09-02",
    updatedAt: "2026-09-02",
    readTime: "8 min read",
    image: getBlogPostImageUrl("adapter-pattern-email-apis"),
    imageAlt: "Email API adapter pattern interface",
    tags: ["Adapters", "Architecture", "TypeScript"],
  },
  {
    slug: "migrate-from-provider-sdk",
    title: "How to Migrate Away From Provider-Specific Email SDKs",
    description:
      "A low-drama migration plan for moving Resend, SendGrid, Postmark, Mailgun, or SES calls behind one app-owned email boundary.",
    publishedAt: "2026-09-09",
    updatedAt: "2026-09-09",
    readTime: "8 min read",
    image: getBlogPostImageUrl("migrate-from-provider-sdk"),
    imageAlt: "Provider-specific email SDK migration plan",
    tags: ["Migration", "Email APIs", "Refactoring"],
  },
  {
    slug: "email-attachments-provider-limits",
    title: "Email Attachments Are Where Provider Abstractions Get Honest",
    description:
      "Attachments look simple in a message object, but providers disagree on size limits, encoding, filenames, and request shape.",
    publishedAt: "2026-09-16",
    updatedAt: "2026-09-16",
    readTime: "7 min read",
    image: getBlogPostImageUrl("email-attachments-provider-limits"),
    imageAlt: "Email attachment provider limits comparison",
    tags: ["Attachments", "Provider limits", "Message shape"],
  },
  {
    slug: "email-metadata-tags-headers",
    title: "Metadata, Tags, and Headers Are Not Interchangeable",
    description:
      "How to decide which data belongs in email metadata, provider tags, custom headers, or your own app database.",
    publishedAt: "2026-09-23",
    updatedAt: "2026-09-23",
    readTime: "7 min read",
    image: getBlogPostImageUrl("email-metadata-tags-headers"),
    imageAlt: "Email metadata tags and headers layers",
    tags: ["Metadata", "Headers", "Tracking"],
  },
  {
    slug: "email-queue-vs-sdk-boundary",
    title: "Your Email Queue and Email SDK Should Do Different Jobs",
    description:
      "Queues decide when work runs. Email SDKs decide how a message becomes a provider request. Mixing those jobs makes outages harder to reason about.",
    publishedAt: "2026-09-30",
    updatedAt: "2026-09-30",
    readTime: "7 min read",
    image: getBlogPostImageUrl("email-queue-vs-sdk-boundary"),
    imageAlt: "Email queue and SDK boundary diagram",
    tags: ["Queues", "Architecture", "Reliability"],
  },
  {
    slug: "deliverability-code-can-control",
    title: "The Deliverability Work Your Code Can Actually Control",
    description:
      "SPF, DKIM, and reputation matter, but code still controls message shape, sender choice, fallback policy, logging, and duplicate sends.",
    publishedAt: "2026-10-07",
    updatedAt: "2026-10-07",
    readTime: "8 min read",
    image: getBlogPostImageUrl("deliverability-code-can-control"),
    imageAlt: "Email deliverability controls inside application code",
    tags: ["Deliverability", "Reliability", "Production"],
  },
  {
    slug: "self-hosted-smtp-vs-email-api",
    title: "Self-Hosted SMTP vs Email APIs: Pick the Pain You Want to Own",
    description:
      "Self-hosted SMTP gives control. Email APIs give product speed. Most teams need a clear boundary more than a dramatic winner.",
    publishedAt: "2026-10-14",
    updatedAt: "2026-10-14",
    readTime: "8 min read",
    image: getBlogPostImageUrl("self-hosted-smtp-vs-email-api"),
    imageAlt: "Self-hosted SMTP and email API tradeoff map",
    tags: ["SMTP", "Email APIs", "Infrastructure"],
  },
  {
    slug: "customer-byo-email-provider",
    title: "Letting Customers Bring Their Own Email Provider",
    description:
      "BYO email provider support sounds simple until customers bring domains, API keys, regions, compliance rules, and their own failure modes.",
    publishedAt: "2026-10-21",
    updatedAt: "2026-10-21",
    readTime: "8 min read",
    image: getBlogPostImageUrl("customer-byo-email-provider"),
    imageAlt: "Customer bring your own email provider setup",
    tags: ["BYO provider", "SaaS", "Multi-tenant"],
  },
  {
    slug: "agents-sending-email-safely",
    title: "Agents Sending Email Need Guardrails, Not Just API Keys",
    description:
      "AI agents can draft, queue, or trigger email, but production apps still need typed boundaries, approvals, capture, and provider-aware validation.",
    publishedAt: "2026-10-28",
    updatedAt: "2026-10-28",
    readTime: "8 min read",
    image: getBlogPostImageUrl("agents-sending-email-safely"),
    imageAlt: "AI agent email sending guardrails",
    tags: ["Agents", "Guardrails", "Email SDK"],
  },
] as const satisfies BlogPost[];

export function getBlogPost(slug: string, options: { includeFuture?: boolean } = {}) {
  const post = blogPosts.find((item) => item.slug === slug);

  if (!post) return undefined;
  if (options.includeFuture || isBlogPostPublished(post)) return post;

  return undefined;
}

export function getAllBlogPosts(): BlogPost[] {
  return [...blogPosts] as BlogPost[];
}

export function getPublishedBlogPosts(date = new Date()): BlogPost[] {
  return getAllBlogPosts()
    .filter((post) => isBlogPostPublished(post, date))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function isBlogPostPublished(post: BlogPost, date = new Date()) {
  return post.publishedAt <= formatDateKey(date);
}

export function getBlogPostUrl(slug: string) {
  return `/blog/${slug}`;
}

export function getBlogPostImageUrl(slug: string) {
  return `/og/blog/${slug}.svg`;
}

export function getBlogPostMetaTitle(title: string) {
  const maxTitleLength = maxBlogMetaTitleLength - blogMetaTitleSuffix.length;

  return `${truncateTitle(title, maxTitleLength)}${blogMetaTitleSuffix}`;
}

function truncateTitle(title: string, maxLength: number) {
  if (title.length <= maxLength) return title;

  const stemLimit = Math.max(1, maxLength - 3);
  const wordBoundaryStem = title
    .slice(0, stemLimit)
    .replace(/\s+\S*$/, "")
    .replace(/[.,;:\s]+$/, "");
  const stem = wordBoundaryStem || title.slice(0, stemLimit).trimEnd();

  return `${stem}...`;
}

export function formatBlogDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
