import type { BlogPost } from "./blog-types";
import { getBlogPostUrl } from "./blog";
import { absolutizeSiteLinks } from "./markdown-links";
import { siteUrl } from "./shared";

// Markdown mirror of /blog/<slug> served at <url>.md, matching the /docs/*.md
// and /compare/<pair>.md conventions. Answer engines get the post as markdown
// instead of having to parse the rendered page.
export function renderBlogPostMarkdown(post: BlogPost, markdown: string) {
  const canonicalUrl = `${siteUrl}${getBlogPostUrl(post.slug)}`;

  return `# ${post.title}

> ${post.description}

Canonical page: ${canonicalUrl}
Published: ${post.publishedAt}. Updated: ${post.updatedAt}.

${absolutizeSiteLinks(markdown)}
`;
}
