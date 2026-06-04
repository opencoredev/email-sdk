# @opencoredev/email-sdk

## 0.6.0

### Minor Changes

- 4db1cd7: Add an official Iterable adapter for target campaign email sends.
- 2b1fbf1: Add the Sequenzy transactional email adapter, CLI support, docs, tests, and a local API-auth smoke check.

## 0.5.0

### Minor Changes

- 074d2a2: Add the Unosend REST API adapter, including the package subpath export, CLI adapter support, payload mapping, docs, and provider catalog entry.

## 0.4.0

### Minor Changes

- Add and harden the Cloudflare Email Sending adapter for the REST API, including the SDK subpath export, CLI adapter support, payload validation, response-envelope validation, tests, and docs.

### Patch Changes

- 40f787a: Run the CLI with Node as well as Bun and document the scoped npx command for one-off CLI usage.
- 2640992: Fix CLI dry-run adapter validation, CLI credential checks, batch routing aliases, and retry handling for transient transport errors.
- b9eb02f: Improve npm package metadata and README links for the Email SDK launch.
- 76fc0ef: Align provider adapters with current API docs for MailerSend response IDs, Mailtrap metadata and response IDs, Scaleway payload shape, Plunk send fields and response IDs, and Loops transactional ID validation and attachments.

## 0.3.0

### Minor Changes

- 6b59659: Add the Email SDK plugin system with built-in defaults, observability, and capture plugins, plus docs for publishing community plugins and adapter plugins.

### Patch Changes

- 17e8a6f: Add an `email-sdk version` CLI command so users and agents can verify the installed SDK and CLI version.
- 2359d77: Clarify CLI installation and one-off `bunx` usage in the package docs.

## 0.2.0

### Minor Changes

- c092005: Prepare the first public scoped release with automated versioning, npm publishing, and CLI distribution metadata.
