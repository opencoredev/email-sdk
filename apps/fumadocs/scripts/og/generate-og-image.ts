// Build-time generation of the site-wide Open Graph image.
//
// The card mirrors the production landing page: the alpine hero, the current
// product mark and headline, an exact code-to-inbox proof, and every sponsor.
// Adapter and sponsor counts come from the same sources used by the site so the
// rendered image cannot drift from the product or sponsor pages.
import { readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import { Resvg } from "@resvg/resvg-js";

import { providers } from "../../src/lib/providers";
import { sponsors } from "../../src/lib/sponsors";

const ogDir = import.meta.dirname;
const publicDir = join(ogDir, "../../public");
const outputFile = join(publicDir, "og/email-sdk.png");

const width = 1200;
const height = 630;
const adapterCount = providers.length;

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

const heroImage = toDataUri(join(publicDir, "landing/alpine-hero.png"));
const gmailMark = toDataUri(join(publicDir, "landing/gmail.png"));

const codeColors = {
  keyword: "#c4b5fd",
  function: "#93c5fd",
  string: "#86efac",
  property: "#7dd3fc",
  default: "#f4f4f5",
} as const;

type Token = [color: keyof typeof codeColors, text: string];

const codeLines: Token[][] = [
  [
    ["keyword", "await"],
    ["default", " email."],
    ["function", "send"],
    ["default", "({"],
  ],
  [
    ["property", "  subject"],
    ["default", ": "],
    ["string", "'Welcome'"],
    ["default", ","],
  ],
  [
    ["property", "  text"],
    ["default", ": "],
    ["string", "'Hi Ada, your account is ready.'"],
    ["default", ","],
  ],
  [["default", "})"]],
];

function codeSvg(): string {
  const x = 690;
  const y = 112;
  const lineHeight = 31;
  const firstLineY = y + 53;
  const lines = codeLines
    .map((tokens, index) => {
      if (tokens.length === 0) return "";
      const spans = tokens
        .map(([color, text]) => `<tspan fill="${codeColors[color]}">${escapeXml(text)}</tspan>`)
        .join("");
      return `<text x="${x + 26}" y="${firstLineY + index * lineHeight}" font-family="Liberation Mono" font-size="15" xml:space="preserve">${spans}</text>`;
    })
    .join("\n");

  return `
    <g filter="url(#panel-shadow)">
      <rect x="${x}" y="${y}" width="450" height="174" rx="20" fill="#090909" fill-opacity="0.92" stroke="#ffffff" stroke-opacity="0.16"/>
      ${lines}
    </g>`;
}

function inboxSvg(): string {
  const x = 748;
  const y = 330;
  return `
    <path d="M915 294V329" stroke="#ffffff" stroke-opacity="0.4" stroke-width="2"/>
    <path d="M908 321L915 329L922 321" stroke="#ffffff" stroke-opacity="0.58" stroke-width="2" fill="none"/>
    <g filter="url(#notification-shadow)">
      <rect x="${x}" y="${y}" width="392" height="130" rx="24" fill="#f4f4f3"/>
      <rect x="${x + 22}" y="${y + 22}" width="40" height="40" rx="10" fill="#ffffff"/>
      <image href="${gmailMark}" x="${x + 28}" y="${y + 29}" width="28" height="22" preserveAspectRatio="xMidYMid meet"/>
      <text x="${x + 76}" y="${y + 41}" font-family="Liberation Sans" font-size="16" font-weight="bold" fill="#363636">Gmail</text>
      <text x="${x + 365}" y="${y + 41}" text-anchor="end" font-family="Liberation Sans" font-size="14" fill="#787878">now</text>
      <text x="${x + 22}" y="${y + 81}" font-family="Liberation Sans" font-size="19" font-weight="bold" fill="#181818">Welcome</text>
      <text x="${x + 22}" y="${y + 108}" font-family="Liberation Sans" font-size="15" fill="#5f5f5f">Hi Ada, your account is ready.</text>
    </g>`;
}

const sponsorLogoSizes: Record<string, number> = {
  Primitive: 32,
  Neon: 25,
  Sequenzy: 27,
};

function sponsorRowSvg(): string {
  const startX = 174;
  const step = 124;
  const cy = 573;

  return sponsors
    .map((sponsor, index) => {
      const x = startX + index * step;
      const size = sponsorLogoSizes[sponsor.name] ?? 28;
      const logo = toDataUri(join(publicDir, sponsor.logo));
      return `
        <g>
          <circle cx="${x}" cy="${cy}" r="22" fill="#f5f5f4" stroke="#ffffff" stroke-opacity="0.72"/>
          <image href="${logo}" x="${x - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>
          <text x="${x + 32}" y="${cy + 5}" font-family="Liberation Sans" font-size="13" font-weight="bold" fill="#d4d4d4">${escapeXml(sponsor.name)}</text>
        </g>`;
    })
    .join("\n");
}

function buildSvg(): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="hero-shade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#050505" stop-opacity="0.98"/>
        <stop offset="0.5" stop-color="#050505" stop-opacity="0.78"/>
        <stop offset="1" stop-color="#050505" stop-opacity="0.34"/>
      </linearGradient>
      <linearGradient id="vertical-shade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#050505" stop-opacity="0.16"/>
        <stop offset="0.68" stop-color="#050505" stop-opacity="0.3"/>
        <stop offset="1" stop-color="#050505" stop-opacity="0.96"/>
      </linearGradient>
      <filter id="panel-shadow" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#000000" flood-opacity="0.52"/>
      </filter>
      <filter id="notification-shadow" x="-15%" y="-25%" width="130%" height="160%">
        <feDropShadow dx="0" dy="20" stdDeviation="25" flood-color="#000000" flood-opacity="0.5"/>
      </filter>
    </defs>

    <rect width="${width}" height="${height}" fill="#070707"/>
    <image href="${heroImage}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
    <rect width="${width}" height="${height}" fill="url(#hero-shade)"/>
    <rect width="${width}" height="${height}" fill="url(#vertical-shade)"/>
    <rect x="18" y="18" width="1164" height="594" rx="28" stroke="#ffffff" stroke-opacity="0.14"/>

    <text x="60" y="78" font-family="Liberation Sans" font-size="23" font-weight="bold" fill="#f5f5f5">Email SDK</text>
    <text x="60" y="193" font-family="Liberation Sans" font-size="72" font-weight="bold" letter-spacing="-2" fill="#f7f7f7">One route.</text>
    <text x="60" y="273" font-family="Liberation Sans" font-size="72" font-weight="bold" letter-spacing="-2" fill="#f7f7f7">Every provider.</text>
    <text x="62" y="322" font-family="Liberation Sans" font-size="21" fill="#c6c6c6">Send, retry, personalize, and schedule through</text>
    <text x="62" y="352" font-family="Liberation Sans" font-size="21" fill="#c6c6c6">${adapterCount} adapters with one TypeScript API.</text>

    <rect x="60" y="388" width="345" height="40" rx="20" fill="#0a0a0a" fill-opacity="0.78" stroke="#ffffff" stroke-opacity="0.18"/>
    <text x="81" y="413" font-family="Liberation Mono" font-size="13" letter-spacing="0.5" fill="#d4d4d4">bun add @opencoredev/email-sdk</text>

    ${codeSvg()}
    ${inboxSvg()}

    <rect x="0" y="530" width="1200" height="100" fill="#080808" fill-opacity="0.92"/>
    <path d="M0 530H1200" stroke="#ffffff" stroke-opacity="0.12"/>
    <text x="60" y="578" font-family="Liberation Sans" font-size="12" font-weight="bold" letter-spacing="1.6" fill="#8f8f8f">SPONSORS</text>
    ${sponsorRowSvg()}
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
