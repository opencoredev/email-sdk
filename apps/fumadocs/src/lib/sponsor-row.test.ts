import { describe, expect, test } from "bun:test";

import { sponsorRowGeometry, sponsorRowLayout } from "./sponsor-row";
import { sponsors } from "./sponsors";

const names = sponsors.map((sponsor) => sponsor.name);

describe("og sponsor row", () => {
  test("keeps the current sponsor list inside the card border", () => {
    const { slots } = sponsorRowLayout(names);
    const last = slots.at(-1)!;

    expect(slots).toHaveLength(sponsors.length);
    expect(slots[0]!.x).toBe(sponsorRowGeometry.startX);
    expect(last.labelEndX).toBeLessThanOrEqual(sponsorRowGeometry.rightEdge);
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
    const long = sponsorRowLayout(names);

    expect(short.scale).toBe(1);
    expect(long.scale).toBeLessThan(1);
    expect(long.slots.at(-1)!.labelEndX).toBeLessThanOrEqual(sponsorRowGeometry.rightEdge);
  });

  test("fails the build rather than rendering unreadable labels", () => {
    const tooMany = Array.from({ length: 24 }, (_, index) => `Sponsor ${index}`);

    expect(() => sponsorRowLayout(tooMany)).toThrow(/sponsor row no longer fits/);
  });
});
