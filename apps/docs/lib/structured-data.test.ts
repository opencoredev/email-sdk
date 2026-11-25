import { describe, expect, test } from "bun:test";

import { buildAdapterFaq, getAdapterSupportEntry } from "./adapter-faq";
import { comparePairs } from "./compare";
import {
  buildBlogIndexStructuredData,
  buildPageStructuredData,
  type JsonLdNode,
  type JsonLdValue,
  serializeJsonLd,
} from "./structured-data";

const routeTitles = new Map([
  ["/docs", "Introduction"],
  ["/docs/adapters", "Adapters"],
]);

function graphOf(node: JsonLdNode): JsonLdNode[] {
  const graph = node["@graph"];

  if (!Array.isArray(graph)) throw new Error("expected a @graph");

  return graph.filter((entry): entry is JsonLdNode => !Array.isArray(entry) && entry === Object(entry));
}

function nodeOfType(node: JsonLdNode, type: string): JsonLdNode {
  const found = graphOf(node).find((entry) => entry["@type"] === type);

  if (!found) throw new Error(`no ${type} node`);

  return found;
}

function types(node: JsonLdNode): JsonLdValue[] {
  return graphOf(node).map((entry) => entry["@type"] ?? "");
}

describe("buildPageStructuredData", () => {
  test("an adapter page carries its visible FAQ and a breadcrumb through its parents", () => {
    const data = buildPageStructuredData({
      route: "/docs/adapters/resend",
      title: "Resend",
      routeTitles,
    });

    const entry = getAdapterSupportEntry("adapters/resend.mdx");

    if (!entry) throw new Error("no Resend support entry");

    expect(types(data)).toEqual(["WebSite", "Organization", "TechArticle", "BreadcrumbList", "FAQPage"]);
    expect(nodeOfType(data, "FAQPage").mainEntity).toEqual(
      buildAdapterFaq(entry).map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    );
    expect(nodeOfType(data, "BreadcrumbList").itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Email SDK", item: "https://email-sdk.dev" },
      { "@type": "ListItem", position: 2, name: "Docs", item: "https://email-sdk.dev/docs" },
      { "@type": "ListItem", position: 3, name: "Adapters", item: "https://email-sdk.dev/docs/adapters" },
      { "@type": "ListItem", position: 4, name: "Resend", item: "https://email-sdk.dev/docs/adapters/resend" },
    ]);
  });

  test("a breadcrumb skips folders that have no page", () => {
    const data = buildPageStructuredData({
      route: "/docs/getting-started/quickstart",
      title: "Quickstart",
      routeTitles,
    });

    expect(nodeOfType(data, "BreadcrumbList").itemListElement).toHaveLength(3);
    expect(types(data)).not.toContain("FAQPage");
  });

  test("every compare pair carries a FAQPage", () => {
    for (const pair of comparePairs) {
      const data = buildPageStructuredData({ route: `/compare/${pair.slug}`, title: pair.slug, routeTitles });

      expect(types(data)).toContain("FAQPage");
    }
  });

  test("the compare index is a CollectionPage listing every pair", () => {
    const data = buildPageStructuredData({ route: "/compare", title: "Compare", routeTitles });

    expect(types(data)).toEqual(["WebSite", "Organization", "CollectionPage", "ItemList", "BreadcrumbList"]);
    expect(nodeOfType(data, "ItemList").numberOfItems).toBe(comparePairs.length);
  });

  test("a tool page is a free WebApplication, not an article", () => {
    const data = buildPageStructuredData({
      route: "/tools/email-dns-checker",
      title: "Email DNS checker",
      modified: "2026-09-24T00:00:00.000Z",
      routeTitles,
    });

    expect(types(data)).toEqual(["WebSite", "Organization", "WebApplication", "BreadcrumbList"]);
    expect(nodeOfType(data, "WebApplication")).toMatchObject({
      dateModified: "2026-09-24T00:00:00.000Z",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    });
  });

  test("a blog post is a dated BlogPosting under Blog", () => {
    const data = buildPageStructuredData({
      route: "/blog/resend-pricing",
      title: "Resend pricing",
      pageType: "blog",
      published: new Date("2026-10-30"),
      modified: "2026-11-23",
      routeTitles,
    });

    expect(nodeOfType(data, "BlogPosting")).toMatchObject({
      datePublished: "2026-10-30T00:00:00.000Z",
      dateModified: "2026-11-23T00:00:00.000Z",
    });
    expect(nodeOfType(data, "BreadcrumbList").itemListElement).toHaveLength(3);
  });
});

describe("buildBlogIndexStructuredData", () => {
  test("lists each post in the Blog and the ItemList", () => {
    const data = buildBlogIndexStructuredData(
      [
        {
          title: "Post",
          description: "About it.",
          href: "/blog/post",
          date: new Date("2026-11-01"),
          image: "/og/blog/post.png",
        },
      ],
      "The blog.",
    );

    expect(types(data)).toEqual(["WebSite", "Organization", "Blog", "ItemList", "BreadcrumbList"]);
    expect(nodeOfType(data, "Blog").blogPost).toEqual([
      {
        "@type": "BlogPosting",
        headline: "Post",
        description: "About it.",
        datePublished: "2026-11-01T00:00:00.000Z",
        url: "https://email-sdk.dev/blog/post",
        image: "https://email-sdk.dev/og/blog/post.png",
      },
    ]);
  });
});

test("serializeJsonLd escapes < so a value can't close the script tag", () => {
  expect(serializeJsonLd({ name: "</script>" })).toBe('{"name":"\\u003c/script>"}');
});
