// Build-time Open Graph cards for the curated /compare/<pair> pages.
//
// One PNG per pair under public/og/compare/, referenced from each page's
// og:image tags. PNG, not the runtime SVG used for blog cards, because the
// major social unfurlers do not rasterize SVG OG images. The layout mirrors
// the blog cards so both surfaces share one visual language.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Resvg } from "@resvg/resvg-js";

import { comparePairs, getComparePairTitle, getProvider } from "../../src/lib/compare";

const ogDir = import.meta.dirname;

const fontsDir = join(ogDir, "fonts");

const outputDir = join(ogDir, "../../public/og/compare");

const width = 1200;

const height = 630;

// Same palette set as the runtime blog OG cards.
const palettes = [
  ["#121214", "#f2d492", "#6ee7b7", "#8aa8ff"],
  ["#111318", "#f7b267", "#89ddff", "#f78fb3"],
  ["#101414", "#a7f3d0", "#f6bd60", "#83c5be"],
  ["#151218", "#f4a261", "#a8dadc", "#e9c46a"],
  ["#101217", "#cdb4db", "#ffd166", "#06d6a0"],
] as const;

type Pair = (typeof comparePairs)[number];

function hashSlug(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildCard(pair: Pair): string {
  const a = getProvider(pair.a);
  const b = getProvider(pair.b);
  const title = getComparePairTitle(pair);
  const palette = palettes[hashSlug(pair.slug) % palettes.length] ?? palettes[0];
  const [background, primary, secondary, accent] = palette;
  const seed = hashSlug(pair.slug);
  const xOffset = seed % 160;
  const yOffset = (seed >> 3) % 90;
  const nameSize = title.length > 18 ? 60 : 72;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">Open Graph card for the ${escapeXml(title)} provider comparison on email-sdk.dev</desc>
  <rect width="${width}" height="${height}" fill="${background}"/>
  <rect x="44" y="44" width="1112" height="542" rx="28" fill="#ffffff" fill-opacity="0.035" stroke="#ffffff" stroke-opacity="0.11"/>
  <ellipse cx="${960 - xOffset / 2}" cy="${250 + yOffset / 2}" rx="220" ry="110" fill="${primary}" fill-opacity="0.17"/>
  <ellipse cx="${930 - xOffset / 3}" cy="${360 - yOffset / 4}" rx="220" ry="125" fill="${secondary}" fill-opacity="0.15"/>
  <g opacity="0.9">
    <rect x="${770 - xOffset}" y="132" width="236" height="58" rx="14" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.13"/>
    <rect x="${835 - xOffset}" y="251" width="266" height="58" rx="14" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.13"/>
    <rect x="${740 - xOffset}" y="370" width="206" height="58" rx="14" fill="#ffffff" fill-opacity="0.08" stroke="#ffffff" stroke-opacity="0.13"/>
    <circle cx="${770 - xOffset}" cy="161" r="9" fill="${primary}"/>
    <circle cx="${835 - xOffset}" cy="280" r="9" fill="${accent}"/>
    <circle cx="${740 - xOffset}" cy="399" r="9" fill="${secondary}"/>
  </g>
  <text x="96" y="112" fill="${primary}" font-family="Liberation Sans" font-size="24" font-weight="700" letter-spacing="0.04em">EMAIL SDK / COMPARE PROVIDERS</text>
  <text x="96" y="151" fill="#ffffff" fill-opacity="0.58" font-family="Liberation Sans" font-size="22">Transactional email API comparison</text>
  <text x="96" y="300" fill="#ffffff" font-family="Liberation Sans" font-size="${nameSize}" font-weight="700">${escapeXml(a.name)} <tspan fill="${primary}">vs</tspan> ${escapeXml(b.name)}</text>
  <text x="96" y="372" fill="#ffffff" fill-opacity="0.68" font-family="Liberation Sans" font-size="27">Message-field support, fallback compatibility,</text>
  <text x="96" y="410" fill="#ffffff" fill-opacity="0.68" font-family="Liberation Sans" font-size="27">and one typed send() for both.</text>
  <text x="96" y="560" fill="${secondary}" font-family="Liberation Mono" font-size="22" font-weight="700">email-sdk.dev/compare/${escapeXml(pair.slug)}</text>
</svg>`;
}

function render(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [
        join(fontsDir, "LiberationSans-Regular.ttf"),
        join(fontsDir, "LiberationSans-Bold.ttf"),
        join(fontsDir, "LiberationMono-Regular.ttf"),
        join(fontsDir, "LiberationMono-Bold.ttf"),
      ],
      loadSystemFonts: false,
      defaultFontFamily: "Liberation Sans",
    },
    fitTo: { mode: "width", value: width },
  });

  return resvg.render().asPng();
}

mkdirSync(outputDir, { recursive: true });

for (const pair of comparePairs) {
  const outputFile = join(outputDir, `${pair.slug}.png`);
  const png = render(buildCard(pair));

  writeFileSync(outputFile, png);
}

console.log(`[og] wrote ${comparePairs.length} compare OG cards to ${outputDir}`);
