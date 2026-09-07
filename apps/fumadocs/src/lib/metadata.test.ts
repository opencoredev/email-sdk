import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import { buildDocsStructuredData, homeStructuredData, siteImageAlt, siteMeta, siteTitle } from "@/lib/metadata";
import { providers } from "@/lib/providers";
import { appDescription, llmsOverview, siteOgImageUrl } from "@/lib/shared";

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

describe("homepage product explanation", () => {
  const home = readFileSync(new URL("../routes/index.tsx", import.meta.url), "utf8");

  test("uses one complete send example on desktop and mobile", () => {
    expect(home).toContain('id="landing-heading">Email for TypeScript apps.</h1>');
    expect(home.match(/aria-label="TypeScript email send example"/g)).toHaveLength(1);
    // The code panel renders tokens as JSX spans, so match the literals it contains.
    expect(home).toContain("'@opencoredev/email-sdk/resend'");
    expect(home).toMatch(/apiKey: process\.env\.["}]*\s*<em>RESEND_API_KEY<\/em>\s*\{"! \}\)\],"\}/);
    expect(home).toContain("'Acme <hello@acme.dev>'");
    expect(home).toContain("'ada@example.com'");
    expect(home).toContain("retry: { maxAttempts: 1 }");
    expect(home).not.toContain("landing-mobile-only");
    expect(home).toMatch(/if you enable retries, a retryable unknown outcome\s+can be retried/);
  });

  test("links practical next steps to existing current docs", () => {
    for (const match of home.matchAll(/docsPath="(\/docs[^"{}]*)"/g)) {
      const path = match[1]!.replace(/^\/docs\/?/, "");
      const base = new URL(`../../content/docs/${path}`, import.meta.url);
      expect(existsSync(`${base.pathname}.mdx`) || existsSync(`${base.pathname}/index.mdx`)).toBe(true);
    }
  });

  test("leads every product surface with the same positioning", () => {
    const readmes = [
      readFileSync(new URL("../../../../README.md", import.meta.url), "utf8"),
      readFileSync(new URL("../../../../packages/email-sdk/README.md", import.meta.url), "utf8"),
      readFileSync(new URL("../../content/docs/index.mdx", import.meta.url), "utf8"),
    ];
    expect(appDescription.startsWith("Email for TypeScript apps.")).toBe(true);
    expect(siteTitle).toContain("Email for TypeScript apps.");
    expect(siteImageAlt).toContain("Email for TypeScript apps.");
    for (const text of [appDescription, ...readmes]) {
      expect(text).toContain("Email for TypeScript apps.");
      expect(text).toContain("existing provider account");
      expect(text).not.toMatch(/guarantee[sd]? (inbox )?delivery|99\.\d+%|testimonial/i);
    }
    for (const text of readmes) {
      expect(text).toContain("23 provider API");
      expect(text).toContain("24 adapters total");
    }
    expect(llmsOverview).toContain("24 adapters total");
    const webpage = homeStructuredData["@graph"].find((node) => node["@type"] === "WebPage");
    expect(webpage?.speakable.cssSelector).toEqual(["#landing-heading", "#landing-summary"]);
    const faq = homeStructuredData["@graph"].find((node) => node["@type"] === "FAQPage");
    expect(faq?.mainEntity[0]?.acceptedAnswer.text.startsWith("Email for TypeScript apps.")).toBe(true);
  });

  test("keeps machine-readable copy within the runtime and delivery boundaries", () => {
    expect(appDescription).toContain("existing provider account");
    expect(llmsOverview).toContain("Node.js 20+ or Bun 1.1+");
    expect(llmsOverview).toContain("not delivery");
    expect(llmsOverview).toContain("direct provider SDK is sufficient");
    const software = homeStructuredData["@graph"].find((node) => node["@type"] === "SoftwareApplication");
    expect(software?.runtimePlatform).toEqual(["Node.js 20+", "Bun 1.1+"]);
    const webpage = homeStructuredData["@graph"].find((node) => node["@type"] === "WebPage");
    for (const selector of webpage?.speakable.cssSelector ?? []) {
      expect(home).toContain(`id="${selector.slice(1)}"`);
    }
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
