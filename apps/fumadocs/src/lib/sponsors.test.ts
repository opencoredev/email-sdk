import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { openSponsorSlots, sponsors } from "./sponsors";

const publicDir = join(import.meta.dirname, "../../public");

// The landing grid is five tiles wide, so the sponsors plus the open slots
// must fill whole rows or the last row shows a single orphan tile.
const landingColumns = 5;

describe("sponsors", () => {
  test("every logo is present under public/", () => {
    for (const sponsor of sponsors) {
      expect(existsSync(join(publicDir, sponsor.logo))).toBe(true);
    }
  });

  test("names and links are unique", () => {
    expect(new Set(sponsors.map((sponsor) => sponsor.name)).size).toBe(sponsors.length);
    expect(new Set(sponsors.map((sponsor) => sponsor.href)).size).toBe(sponsors.length);
  });

  test("links are absolute https urls", () => {
    for (const sponsor of sponsors) {
      expect(sponsor.href).toStartWith("https://");
    }
  });

  test("fills whole rows of the landing grid", () => {
    expect((sponsors.length + openSponsorSlots.length) % landingColumns).toBe(0);
  });
});
