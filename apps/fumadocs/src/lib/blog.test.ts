import { describe, expect, test } from "bun:test";

import {
  dedupeSlug,
  estimateReadTime,
  excerptFromMarkdown,
  mapNotraPost,
  type NotraPostInput,
  renderMarkdownToSafeHtml,
  slugify,
  stripLeadingH1,
  toDateKey,
} from "../../scripts/notra-content";
import { getBlogPostMetaTitle } from "./blog";

function notraPost(overrides: Partial<NotraPostInput> = {}): NotraPostInput {
  return {
    id: "post_1",
    title: "My First Post",
    slug: null,
    content: "",
    markdown: "# My First Post\n\nThe body starts here.",
    status: "published",
    createdAt: "2026-06-01T12:00:00.000Z",
    updatedAt: "2026-06-02T08:30:00.000Z",
    ...overrides,
  };
}

describe("slugify", () => {
  test("lowercases, strips punctuation, and collapses separators", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("Multiple   spaces")).toBe("multiple-spaces");
  });

  test("strips diacritics", () => {
    expect(slugify("Café Crème")).toBe("cafe-creme");
  });
});

describe("dedupeSlug", () => {
  test("suffixes collisions and tracks seen slugs", () => {
    const seen = new Set<string>();
    expect(dedupeSlug("post", seen)).toBe("post");
    expect(dedupeSlug("post", seen)).toBe("post-2");
    expect(dedupeSlug("post", seen)).toBe("post-3");
  });
});

describe("toDateKey", () => {
  test("normalizes an ISO timestamp to a UTC date key", () => {
    expect(toDateKey("2026-06-01T12:34:56.000Z")).toBe("2026-06-01");
  });
});

describe("estimateReadTime", () => {
  test("rounds to whole minutes at 200 wpm with a one-minute floor", () => {
    expect(estimateReadTime("word ".repeat(200))).toBe("1 min read");
    expect(estimateReadTime("word ".repeat(450))).toBe("2 min read");
    expect(estimateReadTime("")).toBe("1 min read");
  });
});

describe("stripLeadingH1 + excerptFromMarkdown", () => {
  test("drops a single leading H1", () => {
    expect(stripLeadingH1("# Title\n\nBody")).toBe("Body");
    expect(stripLeadingH1("No heading here")).toBe("No heading here");
  });

  test("uses the first prose paragraph, skipping the title, headings, and images", () => {
    const markdown = "# Title\n\n![cover](https://img/x.png)\n\n## Section\n\nThe real intro.";
    expect(excerptFromMarkdown(markdown)).toBe("The real intro.");
  });

  test("truncates long paragraphs at a word boundary", () => {
    const excerpt = excerptFromMarkdown(`Intro. ${"alpha ".repeat(60)}`);
    expect(excerpt.length).toBeLessThanOrEqual(156);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});

describe("renderMarkdownToSafeHtml", () => {
  test("renders Markdown structure", () => {
    const html = renderMarkdownToSafeHtml("## Heading\n\nA paragraph with **bold**.");
    expect(html).toContain("<h2");
    expect(html).toContain("<strong>bold</strong>");
  });

  test("removes script tags and their contents", () => {
    const html = renderMarkdownToSafeHtml('<script>alert("xss")</script>\n\nSafe copy.');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
    expect(html).toContain("Safe copy.");
  });

  test("hardens external links and lazy-loads images", () => {
    const link = renderMarkdownToSafeHtml("Visit [Example](https://example.com).");
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');

    const image = renderMarkdownToSafeHtml("![cat](https://example.com/cat.png)");
    expect(image).toContain('loading="lazy"');
  });
});

describe("mapNotraPost", () => {
  test("maps a published post into the blog shape", () => {
    const mapped = mapNotraPost(notraPost(), new Set());

    expect(mapped).not.toBeNull();
    expect(mapped?.post.slug).toBe("my-first-post");
    expect(mapped?.post.image).toBe("/og/blog/my-first-post.svg");
    expect(mapped?.post.publishedAt).toBe("2026-06-01");
    expect(mapped?.post.tags).toEqual([]);
    expect(mapped?.post.description).toBe("The body starts here.");
    // The page renders the title separately, so the body H1 is stripped.
    expect(mapped?.html).not.toContain("<h1");
    expect(mapped?.html).toContain("The body starts here.");
  });

  test("prefers an explicit slug when present", () => {
    const mapped = mapNotraPost(notraPost({ slug: "custom-slug" }), new Set());
    expect(mapped?.post.slug).toBe("custom-slug");
  });

  test("sanitizes an explicit slug into a single path segment", () => {
    const mapped = mapNotraPost(notraPost({ slug: "release/notes" }), new Set());
    expect(mapped?.post.slug).toBe("release-notes");
  });

  test("skips drafts", () => {
    expect(mapNotraPost(notraPost({ status: "draft" }), new Set())).toBeNull();
  });

  test("skips posts without a Markdown body (image-type posts)", () => {
    // @usenotra/sdk 1.3.x: image posts carry `markdown: null` and put an image
    // URL in `content` — there is no prose body for the blog to render.
    const mapped = mapNotraPost(
      notraPost({ markdown: null, content: "https://cdn.usenotra.com/posts/post_1.png" }),
      new Set(),
    );
    expect(mapped).toBeNull();
  });
});

describe("getBlogPostMetaTitle", () => {
  test("appends the suffix and keeps titles within the search-snippet limit", () => {
    const short = getBlogPostMetaTitle("Sending email without a vendor lock-in");
    expect(short.endsWith(" - Email SDK")).toBe(true);
    expect(short.length).toBeLessThanOrEqual(68);

    const long = getBlogPostMetaTitle(
      "An extremely long blog post title that goes well beyond the search snippet limit",
    );
    expect(long.endsWith(" - Email SDK")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(68);
  });
});
