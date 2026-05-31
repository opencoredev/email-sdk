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
    publishedAt: "2026-06-01",
    updatedAt: "2026-06-01",
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
    publishedAt: "2026-06-01",
    updatedAt: "2026-06-01",
    readTime: "6 min read",
    image: "/og/email-sdk.png",
    imageAlt: "Email SDK TypeScript email provider comparison preview",
    tags: ["Nodemailer", "TypeScript", "SMTP"],
  },
] as const satisfies BlogPost[];

export function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}

export function getBlogPostUrl(slug: string) {
  return `/blog/${slug}`;
}
