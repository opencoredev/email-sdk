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

export const blogPosts = [
  {
    slug: "introducing-email-sdk",
    title: "Introducing Email SDK",
    description:
      "Email SDK launched on June 1, 2026: one TypeScript client for transactional email across Resend, SMTP, Postmark, SendGrid, Mailgun, AWS SES, and more.",
    publishedAt: "2026-06-01",
    updatedAt: "2026-06-01",
    readTime: "6 min read",
    image: "/og/email-sdk.png",
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
    image: "/og/email-sdk.png",
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
    image: "/og/email-sdk.png",
    imageAlt: "Email SDK TypeScript email provider comparison preview",
    tags: ["Nodemailer", "TypeScript", "SMTP"],
  },
] as const satisfies BlogPost[];

export function getBlogPost(slug: string, options: { includeFuture?: boolean } = {}) {
  const post = blogPosts.find((item) => item.slug === slug);

  if (!post) return undefined;
  if (options.includeFuture || isBlogPostPublished(post)) return post;

  return undefined;
}

export function getPublishedBlogPosts(date = new Date()): BlogPost[] {
  return (blogPosts as BlogPost[])
    .filter((post) => isBlogPostPublished(post, date))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function isBlogPostPublished(post: BlogPost, date = new Date()) {
  return post.publishedAt <= formatDateKey(date);
}

export function getBlogPostUrl(slug: string) {
  return `/blog/${slug}`;
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
