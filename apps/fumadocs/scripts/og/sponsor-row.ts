// Geometry for the sponsor row at the foot of the OG image. It sits between
// the "SPONSORS" label and the card border, so it cannot use a fixed step:
// every new sponsor would push the last name off the canvas. Each slot is
// measured from its own name, and the whole row scales down until it fits,
// which keeps the logo, the label and the spacing in proportion.
//
// The layout lives apart from generate-og-image.ts so the fit can be tested
// without rendering the image.
import { join } from "node:path";

import { loadFontMetrics } from "./font-metrics";

export const sponsorRowGeometry = {
  startX: 168,
  rightEdge: 1170,
  cy: 573,
  radius: 22,
  labelOffset: 32,
  fontSize: 13,
  /** Blank space kept between a label and the next logo. */
  minClearance: 14,
  /** Below this the labels get too small to read, so the build must fail. */
  minScale: 0.7,
} as const;

// The row labels are drawn in Liberation Sans Bold. generate-og-image.ts hands
// this same file to resvg, so the width measured here is the width the renderer
// draws and the two cannot drift onto different fonts.
export const sponsorLabelFontFile = join(import.meta.dirname, "fonts/LiberationSans-Bold.ttf");

const labelFont = loadFontMetrics(sponsorLabelFontFile);

export function measureSponsorLabel(
  name: string,
  fontSize: number = sponsorRowGeometry.fontSize,
): number {
  return labelFont.measure(name, fontSize);
}

export type SponsorRowSlot = {
  name: string;
  /** Centre of the logo circle. */
  x: number;
  radius: number;
  /** Left edge of the label text. */
  labelX: number;
  /** Right edge of the label text. */
  labelEndX: number;
  fontSize: number;
};

export function sponsorRowLayout(names: readonly string[]): {
  scale: number;
  slots: SponsorRowSlot[];
} {
  const { startX, rightEdge, radius, labelOffset, fontSize, minClearance, minScale } =
    sponsorRowGeometry;

  const labelWidths = names.map((name) => measureSponsorLabel(name));
  const slotWidths = labelWidths.map((label) => labelOffset + label);
  const slotsWidth = slotWidths.reduce((total, slot) => total + slot, 0);
  const gapCount = Math.max(0, names.length - 1);
  // Widths that scale: the slots plus the part of each gap the logo covers.
  const scalable = slotsWidth + gapCount * radius;
  const available = rightEdge - startX - gapCount * minClearance;
  const scale = Math.min(1, available / scalable);
  if (scale < minScale) {
    throw new Error(
      `[og] sponsor row no longer fits: ${names.length} sponsors need more than ${rightEdge - startX}px`,
    );
  }

  let x = startX;
  const slots = names.map((name, index) => {
    const previous = slotWidths[index - 1];
    if (previous !== undefined) x += previous * scale + radius * scale + minClearance;
    const labelX = x + labelOffset * scale;
    return {
      name,
      x,
      radius: radius * scale,
      labelX,
      labelEndX: labelX + labelWidths[index]! * scale,
      fontSize: fontSize * scale,
    };
  });

  return { scale, slots };
}
