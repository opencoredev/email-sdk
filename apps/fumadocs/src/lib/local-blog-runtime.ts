import articleMarkdown from "../../content/blog/email-sdk-v1-safer-typescript-transactional-email.md?raw";
import { renderMarkdownToSafeHtml } from "../../scripts/notra-content";

import { localBlogPosts } from "./local-blog-posts";

const localBlogBodies: Readonly<Record<string, string>> = {
  "email-sdk-v1-safer-typescript-transactional-email": renderMarkdownToSafeHtml(articleMarkdown),
};

export function getLocalBlogPostDetail(slug: string) {
  const post = localBlogPosts.find((item) => item.slug === slug);
  if (!post) return null;

  return { post, html: localBlogBodies[post.slug] ?? "" };
}
