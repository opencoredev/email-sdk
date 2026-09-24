# anti-slop provenance

- Source: https://github.com/dmmulroy/anti-slop (MIT)
- Commit: c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b (2026-09-10)
- Copied from: `skills/install-anti-slop/assets/anti-slop/` via `skills/install-anti-slop/scripts/install.mjs`
- Installed at: `tools/oxlint/anti-slop/` (generic plugin `index.ts`; the Effect plugin in `effect/` is copied but not registered because this repo does not depend on Effect)
- Dependencies: `oxlint` and `@oxlint/plugins` pinned together at 1.85.0
- Local deviations: none

`checksums.json` pins every vendored file. `scripts/check-lint-policy.ts` fails
when a file changes without a refreshed checksum. When pulling upstream changes,
record the new commit and any deviations here, then run
`bun scripts/check-lint-policy.ts --update-checksums`.
