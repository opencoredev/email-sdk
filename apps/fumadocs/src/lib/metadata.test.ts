import { describe, expect, test } from "bun:test";

import { siteMeta } from "@/lib/metadata";
import { siteOgImageUrl } from "@/lib/shared";

const findByName = (name: string) => siteMeta.filter((meta) => meta.name === name);
const findByProperty = (property: string) => siteMeta.filter((meta) => meta.property === property);

describe("site social metadata", () => {
  test("uses the canonical PNG open graph image exactly once", () => {
    const ogImages = findByProperty("og:image");
    const twitterImages = findByName("twitter:image");

    expect(ogImages).toHaveLength(1);
    expect(twitterImages).toHaveLength(1);
    expect(ogImages[0]?.content).toBe(siteOgImageUrl);
    expect(twitterImages[0]?.content).toBe(siteOgImageUrl);
    expect(siteOgImageUrl).toMatch(/^https:\/\/email-sdk\.dev\/og\/email-sdk\.png\?v=\d+$/);
  });

  test("keeps the Twitter preview on the large image card", () => {
    const twitterCards = findByName("twitter:card");

    expect(twitterCards).toHaveLength(1);
    expect(twitterCards[0]?.content).toBe("summary_large_image");
  });
});
