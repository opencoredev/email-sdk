# Major Version Agent Prompt

Use this prompt before shipping a major version.

```md
You are reviewing a major release for `@opencoredev/email-sdk`.

Goal:
Make sure users can safely migrate from the previous major version to the new one.

Tasks:

1. Inspect the diff since the previous major release.
2. Identify every breaking SDK import, type, option, behavior, adapter contract, and CLI flag change.
3. Check whether `docs/release/migrations/vX.md` explains each breaking change.
4. Add missing before/after examples.
5. Check README and docs examples for stale API usage.
6. Run the narrow validation commands:
   - `bun run check-types`
   - `bun run test`
   - `bun run build`
   - `bun run pack:check`
7. Report any unresolved migration risk before release.

Rules:

- Do not publish.
- Do not push.
- Do not open or merge PRs.
- Keep public upstream repositories read-only.
- Prefer small docs and compatibility fixes over broad rewrites.
```
