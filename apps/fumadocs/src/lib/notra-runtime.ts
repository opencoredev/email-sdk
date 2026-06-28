import { createServerFn } from "@tanstack/react-start";

import type { BlogPost } from "./blog-types";
import type { NotraPostInput } from "../../scripts/notra-content";

export type BlogPostDetail = {
  post: BlogPost;
  html: string;
};

// Server-only: fetch published posts from Notra at request time and map them to
// the blog shape. The blog routes are not prerendered (see vite.config.ts), so
// these run inside the Vercel SSR function and pick up new posts without a
// rebuild. Dynamic imports keep @usenotra/sdk and the Markdown renderer out of
// the client bundle; the API key stays server-side.
async function fetchBlogData(): Promise<{ posts: BlogPost[]; bodies: Record<string, string> }> {
  const apiKey = process.env.NOTRA_API_KEY?.trim();
  if (!apiKey) return { posts: [], bodies: {} };

  const [{ Notra }, { mapNotraPost }] = await Promise.all([
    import("@usenotra/sdk"),
    import("../../scripts/notra-content"),
  ]);

  const notra = new Notra({ bearerAuth: apiKey });
  const raw: NotraPostInput[] = [];
  let page = 1;

  for (;;) {
    const response = await notra.content.listPosts({
      status: "published",
      sort: "desc",
      limit: 100,
      page,
    });
    raw.push(...(response.posts as NotraPostInput[]));

    const nextPage = response.pagination?.nextPage;
    if (!nextPage) break;
    page = nextPage;
  }

  const seenSlugs = new Set<string>();
  const posts: BlogPost[] = [];
  const bodies: Record<string, string> = {};

  for (const item of raw) {
    const mapped = mapNotraPost(item, seenSlugs);
    if (!mapped) continue;

    posts.push(mapped.post);
    bodies[mapped.post.slug] = mapped.html;
  }

  posts.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { posts, bodies };
}

export const getBlogPostsServerFn = createServerFn({ method: "GET" }).handler(async () => {
  return (await fetchBlogData()).posts;
});

export const getBlogPostServerFn = createServerFn({ method: "GET" })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data: slug }): Promise<BlogPostDetail | null> => {
    const { posts, bodies } = await fetchBlogData();
    const post = posts.find((item) => item.slug === slug);
    if (!post) return null;

    return { post, html: bodies[post.slug] ?? "" };
  });
