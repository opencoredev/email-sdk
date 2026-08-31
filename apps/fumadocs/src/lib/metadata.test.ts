import { describe, expect, test } from "bun:test";

import { buildDocsStructuredData, homeStructuredData, siteImageAlt, siteMeta } from "@/lib/metadata";
import { providers } from "@/lib/providers";
import { siteOgImageUrl } from "@/lib/shared";

const findByName = (name: string) =>
  siteMeta.filter((meta) => "name" in meta && meta.name === name);
const findByProperty = (property: string) =>
  siteMeta.filter((meta) => "property" in meta && meta.property === property);

describe("site social metadata", () => {
  test("uses the canonical PNG open graph image exactly once", () => {
    const ogImages = findByProperty("og:image");
    const twitterImages = findByName("twitter:image");

    expect(ogImages).toHaveLength(1);
    expect(twitterImages).toHaveLength(1);
    expect(ogImages[0]?.content).toBe(siteOgImageUrl);
    expect(twitterImages[0]?.content).toBe(siteOgImageUrl);

    const ogImageAlts = findByProperty("og:image:alt");
    const twitterImageAlts = findByName("twitter:image:alt");
    expect(ogImageAlts).toHaveLength(1);
    expect(twitterImageAlts).toHaveLength(1);
    expect(ogImageAlts[0]?.content).toBe(siteImageAlt);
    expect(twitterImageAlts[0]?.content).toBe(siteImageAlt);

    const imageUrl = new URL(siteOgImageUrl);
    expect(imageUrl.pathname).toBe("/og/email-sdk.png");
    expect(imageUrl.searchParams.get("v")).toMatch(/\S+/);
  });

  test("keeps the Twitter preview on the large image card", () => {
    const twitterCards = findByName("twitter:card");

    expect(twitterCards).toHaveLength(1);
    expect(twitterCards[0]?.content).toBe("summary_large_image");
  });
});

describe("documentation structured data", () => {
  test("describes current docs as a canonical TechArticle with breadcrumbs", () => {
    const canonicalUrl = "https://email-sdk.dev/docs/adapters/resend";
    const structuredData = buildDocsStructuredData({
      canonicalUrl,
      dateModified: "2026-07-22",
      description: "Configure the Resend adapter for Email SDK.",
      title: "Resend",
    });

    expect(structuredData["@graph"][0]).toMatchObject({
      "@type": "TechArticle",
      "@id": `${canonicalUrl}#article`,
      headline: "Resend",
      dateModified: "2026-07-22",
      url: canonicalUrl,
      mainEntityOfPage: canonicalUrl,
    });
    expect(structuredData["@graph"][1]).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, name: "Email SDK", item: "https://email-sdk.dev" },
        { position: 2, name: "Documentation", item: "https://email-sdk.dev/docs" },
        { position: 3, name: "Resend", item: canonicalUrl },
      ],
    });
  });
});

describe("supported provider structured data", () => {
  const providerNames = providers.map((provider) => provider.name);

  test("lists every registered adapter in the supported providers ItemList", () => {
    const itemList = homeStructuredData["@graph"].find((node) => node["@type"] === "ItemList");

    expect(itemList?.itemListElement.map((item) => item.name)).toEqual(providerNames);
    expect(itemList?.numberOfItems).toBe(providerNames.length);
  });

  test("names every registered adapter in the supported providers FAQ answer", () => {
    const faq = homeStructuredData["@graph"].find((node) => node["@type"] === "FAQPage");
    const answer = faq?.mainEntity.find((question) =>
      question.name.includes("Which email providers"),
    )?.acceptedAnswer.text;

    for (const name of providerNames) {
      expect(answer).toContain(name);
    }
  });
});
