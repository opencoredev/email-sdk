import { describe, expect, test } from "bun:test";

import { sponsors } from "../../src/lib/sponsors";
import { measureSponsorLabel, sponsorRowGeometry, sponsorRowLayout } from "./sponsor-row";

const names = sponsors.map((sponsor) => sponsor.name);

describe("og sponsor row", () => {
  test("measures labels with the font the row renders with", () => {
    // Liberation Sans Bold advances at 13px. A per-character average cannot
    // tell these apart, which is what let a label overrun its slot before.
    expect(measureSponsorLabel("W")).toBeCloseTo(12.27, 1);
    expect(measureSponsorLabel("i")).toBeCloseTo(3.61, 1);
    expect(measureSponsorLabel("WWWW")).toBeGreaterThan(measureSponsorLabel("iiii") * 3);
    expect(measureSponsorLabel("Neon", 26)).toBeCloseTo(measureSponsorLabel("Neon") * 2, 5);
  });

  test("keeps the current sponsor list inside the card border", () => {
    const { slots } = sponsorRowLayout(names);
    const last = slots.at(-1)!;

    expect(slots).toHaveLength(sponsors.length);
    expect(slots[0]!.x).toBe(sponsorRowGeometry.startX);
    expect(last.labelEndX).toBeLessThanOrEqual(sponsorRowGeometry.rightEdge + 0.001);
  });

  test("never lets a label run into the next logo", () => {
    const { slots } = sponsorRowLayout(names);

    for (const [index, slot] of slots.entries()) {
      const next = slots[index + 1];
      if (!next) continue;
      const clearance = next.x - next.radius - slot.labelEndX;
      expect(clearance).toBeGreaterThanOrEqual(sponsorRowGeometry.minClearance - 0.001);
    }
  });

  test("shrinks the row as sponsors are added instead of overflowing", () => {
    const short = sponsorRowLayout(names.slice(0, 4));
    const long = sponsorRowLayout([...names, "Widework"]);

    expect(short.scale).toBe(1);
    expect(long.scale).toBeLessThan(1);
    expect(long.slots.at(-1)!.labelEndX).toBeLessThanOrEqual(sponsorRowGeometry.rightEdge + 0.001);
  });

  test("holds the fit for wide-glyph names, not just average ones", () => {
    const wide = Array.from({ length: 8 }, () => "WWWWWWWW");
    const { slots } = sponsorRowLayout(wide);

    expect(slots.at(-1)!.labelEndX).toBeLessThanOrEqual(sponsorRowGeometry.rightEdge + 0.001);
  });

  test("fails the build rather than rendering unreadable labels", () => {
    const tooMany = Array.from({ length: 24 }, (_, index) => `Sponsor ${index}`);

    expect(() => sponsorRowLayout(tooMany)).toThrow(/sponsor row no longer fits/);
  });
});
