import articleMarkdown from "../../content/blog/email-sdk-v1-safer-typescript-transactional-email.md?raw";
import mailgunAlternativesMarkdown from "../../content/blog/mailgun-alternatives.md?raw";
import mailgunApiMarkdown from "../../content/blog/mailgun-api-nodejs-typescript.md?raw";
import resendApiMarkdown from "../../content/blog/resend-api-nodejs-typescript.md?raw";
import resendPricingMarkdown from "../../content/blog/resend-pricing.md?raw";
import resendSmtpMarkdown from "../../content/blog/resend-smtp-nodejs.md?raw";
import sendEmailNodeMarkdown from "../../content/blog/send-email-nodejs-typescript.md?raw";
import sendgridAlternativesMarkdown from "../../content/blog/sendgrid-alternatives.md?raw";
import { renderMarkdownToSafeHtml } from "../../scripts/notra-content";

import { localBlogPosts } from "./local-blog-posts";

// One Markdown source per local post. The HTML page and the /blog/<slug>.md
// mirror both read from here, so adding a post means adding one entry.
const localBlogMarkdown = new Map([
  ["email-sdk-v1-safer-typescript-transactional-email", articleMarkdown],
  ["mailgun-api-nodejs-typescript", mailgunApiMarkdown],
  ["sendgrid-alternatives", sendgridAlternativesMarkdown],
  ["mailgun-alternatives", mailgunAlternativesMarkdown],
  ["resend-api-nodejs-typescript", resendApiMarkdown],
  ["resend-pricing", resendPricingMarkdown],
  ["send-email-nodejs-typescript", sendEmailNodeMarkdown],
  ["resend-smtp-nodejs", resendSmtpMarkdown],
]);

const localBlogBodies = new Map(
  [...localBlogMarkdown].map(([slug, markdown]) => [slug, renderMarkdownToSafeHtml(markdown)]),
);

export function getLocalBlogPostDetail(slug: string) {
  const post = localBlogPosts.find((item) => item.slug === slug);

  if (!post) return null;

  return { post, html: localBlogBodies.get(post.slug) ?? "" };
}

export function getLocalBlogPostMarkdown(slug: string) {
  return localBlogMarkdown.get(slug) ?? null;
}
