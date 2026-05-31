import { describe, expect, test } from "bun:test";

import { siteImageAlt, siteMeta } from "@/lib/metadata";
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
