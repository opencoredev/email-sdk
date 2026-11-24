// Build-time fetch of published posts from Notra (https://usenotra.com).
//
// Writes each post to content/blog/(notra)/<slug>.md with Blume frontmatter.
// The parenthesized folder adds no URL segment, so a post serves at
// /blog/<slug> like the committed posts, and the folder is gitignored. A
// committed post wins on a slug collision. Run before `blume build`, or on
// demand via `bun run posts:fetch`.
//
// Resilient by design: a missing key or a Notra outage never fails the build.
// Either one clears content/blog/(notra)/, so the build has the committed posts
// only and never republishes posts left over from an earlier run.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Notra } from "@usenotra/sdk";

import {
  type MappedPost,
  mapNotraPost,
  type NotraPostInput,
  stripLeadingH1,
} from "./notra-content";

const contentDir = join(import.meta.dirname, "../content/blog");

const outputDir = join(contentDir, "(notra)");

const pageSize = 100;

async function fetchPublishedPosts(notra: Notra): Promise<NotraPostInput[]> {
  const posts: NotraPostInput[] = [];
  let page = 1;

  for (;;) {
    const response = await notra.content.listPosts({
      status: "published",
      sort: "desc",
      limit: pageSize,
      page,
    });

    posts.push(...response.posts);

    const nextPage = response.pagination?.nextPage;

    if (!nextPage) break;
    page = nextPage;
  }

  return posts;
}

function frontmatter(post: MappedPost["post"]): string {
  return [
    "---",
    `title: ${JSON.stringify(post.title)}`,
    `description: ${JSON.stringify(post.description)}`,
    "type: blog",
    `date: ${post.publishedAt}`,
    `lastModified: ${post.updatedAt}`,
    "---",
  ].join("\n");
}

function committedSlugs(): Set<string> {
  return new Set(
    readdirSync(contentDir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(/\.md$/, "")),
  );
}

function clearFetchedPosts(): void {
  rmSync(outputDir, { force: true, recursive: true });
}

function writePosts(posts: readonly MappedPost[]): number {
  clearFetchedPosts();
  mkdirSync(outputDir, { recursive: true });

  const taken = committedSlugs();
  const today = new Date().toISOString().slice(0, 10);
  let written = 0;

  for (const { post, markdown } of posts) {
    // Scheduled posts stay hidden until their publish date.
    if (taken.has(post.slug) || post.publishedAt > today) continue;

    writeFileSync(
      join(outputDir, `${post.slug}.md`),
      `${frontmatter(post)}\n\n${stripLeadingH1(markdown)}\n`,
    );
    written += 1;
  }

  return written;
}

async function main(): Promise<void> {
  const apiKey = process.env.NOTRA_API_KEY?.trim();

  if (!apiKey) {
    clearFetchedPosts();
    console.warn("[notra] NOTRA_API_KEY is not set, so only the committed blog posts are built.");

    return;
  }

  try {
    const notra = new Notra({ bearerAuth: apiKey });
    const rawPosts = await fetchPublishedPosts(notra);
    const seenSlugs = new Set<string>();

    const posts = rawPosts.flatMap((raw) => {
      const mapped = mapNotraPost(raw, seenSlugs);

      return mapped ? [mapped] : [];
    });

    const written = writePosts(posts);

    console.log(`[notra] wrote ${written} published post(s) to content/blog/(notra)/`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    clearFetchedPosts();
    console.warn(`[notra] fetch failed (${message}); building with the committed posts only.`);
  }
}

await main();
