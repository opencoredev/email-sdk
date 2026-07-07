// Build-time generation of the site-wide OG image (public/og/email-sdk.png).
//
// The whole image is drawn in code — headline, a syntax-highlighted usage
// snippet, the provider logo grid, and the sponsor row — so it can never go
// stale. The adapter count is derived from the SDK package's export map and
// the sponsor row comes from src/lib/sponsors.ts. Runs before `vite build`,
// or on demand via `bun run og:generate`.
//
// Rendering is fully deterministic: logos are inlined as data URIs and text is
// set in bundled Liberation fonts (metric-compatible with Arial/Courier), with
// system fonts disabled so local and CI output are identical.
import { readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import { Resvg } from "@resvg/resvg-js";

import { sponsors } from "../../src/lib/sponsors";

const ogDir = import.meta.dirname;
const publicDir = join(ogDir, "../../public");
const outputFile = join(publicDir, "og/email-sdk.png");

const width = 1200;
const height = 630;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

// Adapter count straight from the SDK's export map, so the number on the image
// tracks reality. Everything under "./" is an adapter entry point except the
// SDK root, plugins, and non-provider utilities.
const sdkPackage = JSON.parse(
  readFileSync(join(ogDir, "../../../../packages/email-sdk/package.json"), "utf8"),
) as { exports: Record<string, unknown> };
const nonAdapterExports = new Set([".", "./testing", "./agent-tools"]);
const adapterCount = Object.keys(sdkPackage.exports).filter(
  (key) => !nonAdapterExports.has(key) && !key.startsWith("./plugins"),
).length;

// Provider marks with a local logo under public/og/provider-logos/, most
// recognizable first. Adapters without a stored mark (SES, SMTP, Cloudflare,
// Iterable) are folded into the trailing "+N" chip. `dark: true` marks logos
// drawn as white/light shapes — they get a dark chip; the rest are dark or
// colored marks (or JPEGs with baked-in white backgrounds) and need white.
const providerLogos: { file: string; dark?: boolean }[] = [
  { file: "resend-mark.svg" },
  { file: "postmark.png" },
  { file: "sendgrid.png" },
  { file: "mailgun.png", dark: true },
  { file: "brevo.png", dark: true },
  { file: "mailersend.png" },
  { file: "mailchimp.png", dark: true },
  { file: "sparkpost.png", dark: true },
  { file: "mailtrap.png", dark: true },
  { file: "loops.png", dark: true },
  { file: "plunk.png" },
  { file: "scaleway.png" },
  { file: "zeptomail.png", dark: true },
  { file: "mailpace.png" },
  { file: "unosend.png", dark: true },
  { file: "sequenzy.jpeg" },
  { file: "jetemail.jpeg" },
  { file: "lettermint.png" },
  { file: "primitive.png" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mimeTypes: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function toDataUri(filePath: string): string {
  const mime = mimeTypes[extname(filePath).toLowerCase()];
  if (!mime) throw new Error(`Unsupported image type for OG embedding: ${filePath}`);
  return `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
}

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// ---------------------------------------------------------------------------
// Code snippet (right panel)
// ---------------------------------------------------------------------------

const codeColors = {
  kw: "#c4b5fd", // keywords
  fn: "#93c5fd", // functions / imported bindings
  str: "#86efac", // strings
  prop: "#7dd3fc", // object keys
  d: "#d4d4d8", // default / punctuation
  cm: "#565660", // comments
} as const;

type Token = [color: keyof typeof codeColors, text: string];

const codeLines: Token[][] = [
  [
    ["kw", "import"],
    ["d", " { "],
    ["fn", "createEmailClient"],
    ["d", " } "],
    ["kw", "from"],
    ["d", " "],
    ["str", '"@opencoredev/email-sdk"'],
    ["d", ";"],
  ],
  [
    ["kw", "import"],
    ["d", " { "],
    ["fn", "resend"],
    ["d", " } "],
    ["kw", "from"],
    ["d", " "],
    ["str", '"@opencoredev/email-sdk/resend"'],
    ["d", ";"],
  ],
  [
    ["kw", "import"],
    ["d", " { "],
    ["fn", "postmark"],
    ["d", " } "],
    ["kw", "from"],
    ["d", " "],
    ["str", '"@opencoredev/email-sdk/postmark"'],
    ["d", ";"],
  ],
  [],
  [
    ["kw", "const"],
    ["d", " email = "],
    ["fn", "createEmailClient"],
    ["d", "({"],
  ],
  [
    ["prop", "  adapters"],
    ["d", ": ["],
    ["fn", "resend"],
    ["d", "(), "],
    ["fn", "postmark"],
    ["d", "()], "],
    ["cm", "// falls back in order"],
  ],
  [["d", "});"]],
  [],
  [
    ["kw", "await"],
    ["d", " email."],
    ["fn", "send"],
    ["d", "({"],
  ],
  [
    ["prop", "  from"],
    ["d", ": "],
    ["str", '"Acme <hello@acme.com>"'],
    ["d", ","],
  ],
  [
    ["prop", "  to"],
    ["d", ": "],
    ["str", '"user@example.com"'],
    ["d", ","],
  ],
  [
    ["prop", "  subject"],
    ["d", ": "],
    ["str", '"Welcome"'],
    ["d", ","],
  ],
  [
    ["prop", "  html"],
    ["d", ": "],
    ["str", '"<p>It works.</p>"'],
    ["d", ","],
  ],
  [["d", "});"]],
];

const card = { x: 520, y: 72, w: 608, h: 440, pad: 24 };
const codeFontSize = 15;
const codeLineHeight = 26;

function codeSvg(): string {
  const headerY = card.y + 28;
  const dividerY = card.y + 46;
  const firstLineY = dividerY + 34;

  const lines = codeLines
    .map((tokens, index) => {
      if (tokens.length === 0) return "";
      const spans = tokens
        .map(([color, text]) => `<tspan fill="${codeColors[color]}">${escapeXml(text)}</tspan>`)
        .join("");
      return `<text x="${card.x + card.pad}" y="${firstLineY + index * codeLineHeight}" font-family="Liberation Mono" font-size="${codeFontSize}" xml:space="preserve">${spans}</text>`;
    })
    .join("\n    ");

  return `
    <rect x="${card.x}" y="${card.y}" width="${card.w}" height="${card.h}" rx="16" fill="#0f0f11" stroke="#26262a" filter="url(#card-shadow)"/>
    <circle cx="${card.x + 26}" cy="${headerY}" r="5.5" fill="#f5655b" fill-opacity="0.85"/>
    <circle cx="${card.x + 44}" cy="${headerY}" r="5.5" fill="#f6bd3b" fill-opacity="0.85"/>
    <circle cx="${card.x + 62}" cy="${headerY}" r="5.5" fill="#43c645" fill-opacity="0.85"/>
    <text x="${card.x + 84}" y="${headerY + 4.5}" font-family="Liberation Mono" font-size="13" fill="#71717a">send.ts</text>
    <line x1="${card.x + 1}" y1="${dividerY}" x2="${card.x + card.w - 1}" y2="${dividerY}" stroke="#1f1f23"/>
    ${lines}`;
}

// ---------------------------------------------------------------------------
// Logo chips
// ---------------------------------------------------------------------------

function logoCircle(
  logoDataUri: string,
  cx: number,
  cy: number,
  r: number,
  clipId: string,
  dark = false,
): string {
  const logoSize = Math.round(r * 1.3);
  return `
    <g>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${dark ? "#1c1c1f" : "#ffffff"}" stroke="#3f3f46" stroke-width="1"/>
      <clipPath id="${clipId}">
        <circle cx="${cx}" cy="${cy}" r="${logoSize / 2}"/>
      </clipPath>
      <image clip-path="url(#${clipId})" href="${logoDataUri}" x="${cx - logoSize / 2}" y="${cy - logoSize / 2}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>
    </g>`;
}

function providerGridSvg(): string {
  const r = 16;
  const step = 41;
  const perRow = 10;
  const startX = 72 + r;
  const rowYs = [394, 438];

  // The grid fits perRow * rowYs.length chips (logos + the "+N" chip). Fail
  // the build instead of silently drawing overflow chips at cy=0.
  if (providerLogos.length + 1 > perRow * rowYs.length) {
    throw new Error(
      `Provider grid overflow: ${providerLogos.length} logos + "+N" chip exceed ${perRow * rowYs.length} slots — extend rowYs in generate-og-image.ts`,
    );
  }

  const chips = providerLogos.map(({ file, dark }, index) => {
    const cx = startX + (index % perRow) * step;
    const cy = rowYs[Math.floor(index / perRow)] ?? 0;
    return logoCircle(
      toDataUri(join(publicDir, "og/provider-logos", file)),
      cx,
      cy,
      r,
      `provider-${index}`,
      dark,
    );
  });

  const remaining = adapterCount - providerLogos.length;
  if (remaining > 0) {
    const index = providerLogos.length;
    const cx = startX + (index % perRow) * step;
    const cy = rowYs[Math.floor(index / perRow)] ?? 0;
    chips.push(`
    <g>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#151518" stroke="#3f3f46" stroke-width="1"/>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="Liberation Mono" font-size="12" fill="#a1a1aa">+${remaining}</text>
    </g>`);
  }

  return chips.join("");
}

function sponsorRowSvg(): string {
  const r = 14;
  const step = 37;
  const startX = 72 + r;
  const cy = 554;

  // Single row bounded by the left column (~448px wide). Fail the build
  // instead of letting sponsor chips run under the code card.
  const maxSlots = Math.floor((448 - r * 2) / step) + 1;
  if (sponsors.length + 1 > maxSlots) {
    throw new Error(
      `Sponsor row overflow: ${sponsors.length} sponsors + open slot exceed ${maxSlots} slots — rework the row layout in generate-og-image.ts`,
    );
  }

  const chips = sponsors.map((sponsor, index) =>
    logoCircle(toDataUri(join(publicDir, sponsor.logo)), startX + index * step, cy, r, `sponsor-${index}`),
  );

  // Trailing dashed "open slot" chip mirrors the website spotlight.
  const cx = startX + sponsors.length * step;
  chips.push(`
    <g>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="#151518" stroke="#52525b" stroke-width="1" stroke-dasharray="4 4"/>
      <path d="M${cx - 4.5} ${cy}H${cx + 4.5}M${cx} ${cy - 4.5}V${cy + 4.5}" stroke="#8f8f98" stroke-width="1.5"/>
    </g>`);

  return chips.join("");
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

function buildSvg(): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="0.72" cy="0.12" r="0.85">
      <stop offset="0" stop-color="#3f3f46" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#3f3f46" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="headline" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#b9b9c1"/>
    </linearGradient>
    <pattern id="dots" width="30" height="30" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="1" fill="#1a1a1e"/>
    </pattern>
    <filter id="card-shadow" x="-8%" y="-8%" width="116%" height="120%">
      <feDropShadow dx="0" dy="14" stdDeviation="22" flood-color="#000000" flood-opacity="0.5"/>
    </filter>
  </defs>

  <rect width="${width}" height="${height}" fill="#09090b"/>
  <rect width="${width}" height="${height}" fill="url(#dots)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>

  <!-- Left column -->
  <text x="72" y="152" font-family="Liberation Sans" font-weight="bold" font-size="78" fill="url(#headline)">Email SDK</text>
  <text x="72" y="206" font-family="Liberation Sans" font-size="27" fill="#a1a1aa">One typed API for</text>
  <text x="72" y="242" font-family="Liberation Sans" font-size="27" fill="#a1a1aa">every email provider.</text>
  <text x="72" y="292" font-family="Liberation Sans" font-size="17" fill="#71717a">Fallback routing · retries · field-support checks · CLI</text>

  <text x="72" y="352" font-family="Liberation Sans" font-size="13" letter-spacing="1.5" fill="#8f8f98">${adapterCount} PROVIDERS, ONE CLIENT</text>
  ${providerGridSvg()}

  <text x="72" y="514" font-family="Liberation Sans" font-size="13" letter-spacing="1.5" fill="#8f8f98">SPONSORED BY</text>
  ${sponsorRowSvg()}

  <!-- Right column -->
  ${codeSvg()}
  <text x="${card.x + card.pad}" y="568" font-family="Liberation Mono" font-size="15" xml:space="preserve"><tspan fill="#52525b">$ </tspan><tspan fill="#a1a1aa">npm install @opencoredev/email-sdk</tspan></text>
  <rect x="${card.x + card.pad + 37 * 9 + 6}" y="555" width="8" height="16" fill="#71717a"/>
</svg>`;
}

function render(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [
        join(ogDir, "fonts/LiberationSans-Regular.ttf"),
        join(ogDir, "fonts/LiberationSans-Bold.ttf"),
        join(ogDir, "fonts/LiberationMono-Regular.ttf"),
        join(ogDir, "fonts/LiberationMono-Bold.ttf"),
      ],
      loadSystemFonts: false,
      defaultFontFamily: "Liberation Sans",
    },
    fitTo: { mode: "width", value: width },
  });
  return resvg.render().asPng();
}

const png = render(buildSvg());
writeFileSync(outputFile, png);
console.log(
  `[og] wrote ${outputFile} (${(png.length / 1024).toFixed(1)} KiB, ${adapterCount} adapters, ${sponsors.length} sponsors)`,
);
