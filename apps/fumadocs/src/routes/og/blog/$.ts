import { createFileRoute } from "@tanstack/react-router";

import type { BlogPost } from "@/lib/blog";
import { getBlogPostServerFn } from "@/lib/notra-runtime";
import { appName, siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/og/blog/$")({
  server: {
    handlers: {
      async GET({ params }) {
        const slug = params._splat?.replace(/\.svg$/, "");

        if (!slug || params._splat === slug) {
          return new Response("Not found", { status: 404 });
        }

        const detail = await getBlogPostServerFn({ data: slug });
        if (!detail) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(renderBlogOgImage(detail.post), {
          headers: {
            "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
            "content-type": "image/svg+xml; charset=utf-8",
          },
        });
      },
    },
  },
});

type OgPost = BlogPost;

const palettes = [
  ["#121214", "#f2d492", "#6ee7b7", "#8aa8ff"],
  ["#111318", "#f7b267", "#89ddff", "#f78fb3"],
  ["#101414", "#a7f3d0", "#f6bd60", "#83c5be"],
  ["#151218", "#f4a261", "#a8dadc", "#e9c46a"],
  ["#101217", "#cdb4db", "#ffd166", "#06d6a0"],
] as const;

function renderBlogOgImage(post: OgPost) {
  const palette = palettes[hashSlug(post.slug) % palettes.length] ?? palettes[0];
  const [background, primary, secondary, accent] = palette;
  const titleLines = limitLines(wrapText(post.title, 28), 3);
  const descriptionLines = limitLines(wrapText(post.description, 54), 2);
  const tag = post.tags[0] ?? "Email SDK";
  const seed = hashSlug(post.slug);
  const xOffset = seed % 160;
  const yOffset = (seed >> 3) % 90;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(post.title)}</title>
  <desc id="desc">${escapeXml(post.imageAlt)}</desc>
  <rect width="1200" height="630" fill="${background}"/>
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
  <text x="96" y="112" fill="${primary}" font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="24" font-weight="700" letter-spacing="0.04em">${escapeXml(appName.toUpperCase())}</text>
  <text x="96" y="151" fill="#ffffff" fill-opacity="0.58" font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22">${escapeXml(formatDate(post.publishedAt))} / ${escapeXml(tag)}</text>
  ${titleLines
    .map(
      (line, index) =>
        `<text x="96" y="${247 + index * 70}" fill="#ffffff" font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="60" font-weight="700">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}
  ${descriptionLines
    .map(
      (line, index) =>
        `<text x="98" y="${492 + index * 34}" fill="#ffffff" fill-opacity="0.68" font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="26">${escapeXml(line)}</text>`,
    )
    .join("\n  ")}
  <text x="96" y="560" fill="${secondary}" font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="700">${escapeXml(siteUrl.replace(/^https?:\/\//, ""))}</text>
</svg>`;
}

function hashSlug(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function wrapText(value: string, maxLength: number) {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxLength) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(...splitLongWord(word, maxLength));
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLength && current) {
      lines.push(current);
      current = word;
      continue;
    }
    current = candidate;
  }

  if (current) lines.push(current);
  return lines;
}

function splitLongWord(word: string, maxLength: number) {
  const chunkSize = Math.max(1, maxLength - 1);
  const chunks: string[] = [];

  for (let index = 0; index < word.length; index += chunkSize) {
    const chunk = word.slice(index, index + chunkSize);
    chunks.push(index + chunkSize < word.length ? `${chunk}-` : chunk);
  }

  return chunks;
}

function limitLines(lines: string[], maxLines: number) {
  if (lines.length <= maxLines) return lines;

  const visible = lines.slice(0, maxLines);
  const last = visible.at(-1);
  if (last) {
    visible[visible.length - 1] = `${last.replace(/[.,;:\s]+$/, "")}...`;
  }

  return visible;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
