# Email SDK docs

The site at [email-sdk.dev](https://email-sdk.dev): docs, blog, provider comparisons, free tools, and the landing page. It is built with [Blume](https://useblume.dev) on Astro and deploys to Vercel as server output, so the MCP server (`/mcp`) and `Accept: text/markdown` work. Blume needs Node 22.19 or later.

```bash
bun run dev        # local dev server on port 4321
bun run build      # prebuild generators and checks, blume build, Vercel header patch
bun run validate   # blume validate --strict: links, anchors, assets, redirects
bun run audit      # blume audit over the last build
bun run types:check
bun test
```

## Layout

| Path | What it holds |
| --- | --- |
| `content/docs` | Current docs, served at `/docs/...` |
| `content/v<release>/docs` | Archived docs, served at `/v<release>/docs/...` and listed in `lib/versions.ts` |
| `content/blog` | Blog posts (`type: blog`), served at `/blog/<slug>` |
| `content/compare` | Provider comparisons, generated from `lib/compare.ts` by `bun run compare:generate` |
| `content/tools` | The tools index and the email DNS checker |
| `content/(project)` | About, stats, contact, privacy, and terms, at the site root |
| `pages/` | Custom Astro pages: the landing page and the blog index |
| `components/`, `islands/` | React components the MDX uses; `islands/` hydrate in the browser |
| `lib/` | Data the pages and the repo's check scripts share: providers, adapter support, pricing, versions, redirects |
| `scripts/` | Build-time generators and checks |

## Generated content

Each generator has a `--check` mode that the build and `bun run docs:check` run, so a stale page fails CI:

- `bun run compare:generate` writes `content/compare/*.mdx` from `lib/compare.ts`.
- `bun run adapter-faq:generate` writes the FAQ section at the end of each adapter page from the adapter support data.
- `bun run registry:generate` writes the shadcn email registry in `public/r` from the code in `content/docs/ui`.

The build also writes, without committing them: Notra posts to `content/blog/(notra)/` (needs `NOTRA_API_KEY`), `public/feed.json` and `public/feeds/docs.jsonl`, and the Open Graph cards in `public/og`.

## Redirects and headers

`blume.config.ts` holds every redirect: the old `/docs/v/<release>/...` archive URLs, renamed docs pages, reversed compare slugs, and the feed and `llms` URLs the Fumadocs site used. After `blume build`, `scripts/patch-vercel-config.ts` adds the security headers, archived nested `index.md` redirects, homepage `Link` discovery headers, and the `/?mode=agent` rewrite from `lib/vercel-headers.ts` to `.vercel/output/config.json`, because Vercel ignores `vercel.json` headers for Build Output API deploys.

## Removed Nitro server endpoints

The previous Fumadocs/Nitro app included `/api/build-info` (for the `StaleBuildNotice` client poller) and a Nitro `@usenotra/geo` server middleware. Both were intentionally removed in the Blume migration so static HTML pages serve directly from Vercel's CDN without per-request server middleware; if Notra GEO tracking is needed again, add an Astro middleware backed by `@usenotra/geo`.
