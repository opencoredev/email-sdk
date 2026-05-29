Add a changeset for every user-visible SDK or CLI change:

```bash
bun run changeset
```

Changesets are accumulated across merged PRs. When `main` has pending changesets, CI opens a `Version packages` PR. Merge that PR when you want a new version to publish.

The generated filename is random and does not need to match the PR name. Keep the file in the feature PR.
