# Email SDK MCP

`@opencoredev/email-sdk-mcp` is the local stdio MCP server for [Email SDK](https://email-sdk.dev). It gives agents a safe email workflow: inspect configuration, validate one email without network access, store an opaque validation reference, and send only after form elicitation approval.

Sending is disabled unless `EMAIL_SDK_MCP_ENABLE_SEND=1`. Provider credentials and the sender identity are read only from the server process environment. SDK telemetry stays disabled inside the MCP server. Never put API keys, SMTP passwords, access tokens, provider base URLs, or message approval state in tool arguments or command-line flags.

## Configure a client

```json
{
  "mcpServers": {
    "email": {
      "command": "npx",
      "args": ["-y", "@opencoredev/email-sdk-mcp"],
      "env": {
        "EMAIL_SDK_MCP_ADAPTER": "resend",
        "EMAIL_SDK_MCP_FROM": "Acme <hello@example.com>",
        "RESEND_API_KEY": "${RESEND_API_KEY}"
      }
    }
  }
}
```

The server does not accept command-line flags or load `.env` files. All configuration comes from the process environment.

## Enable sending deliberately

Keep the default read-only mode while you validate setup. Add send only after the MCP client supports form elicitation and the allowlist policy is set.

```json
{
  "EMAIL_SDK_MCP_ENABLE_SEND": "1",
  "EMAIL_SDK_MCP_ALLOWED_DOMAINS": "example.com",
  "EMAIL_SDK_MCP_MAX_RECIPIENTS": "5"
}
```

Optional policy environment variables:

| Variable | Default | Behavior |
| --- | --- | --- |
| `EMAIL_SDK_MCP_ALLOWED_RECIPIENTS` | unset | Comma-separated exact recipient allowlist. |
| `EMAIL_SDK_MCP_ALLOWED_DOMAINS` | unset | Comma-separated recipient-domain allowlist. |
| `EMAIL_SDK_MCP_MAX_RECIPIENTS` | `10` | Maximum `to` + `cc` + `bcc` recipients. |
| `EMAIL_SDK_MCP_MAX_SUBJECT_LENGTH` | `200` | Maximum subject characters. |
| `EMAIL_SDK_MCP_MAX_TEXT_LENGTH` | `100000` | Maximum plain-text body characters. |
| `EMAIL_SDK_MCP_MAX_HTML_LENGTH` | `100000` | Maximum HTML body characters. |
| `EMAIL_SDK_MCP_VALIDATION_TTL_MS` | `300000` | Validation reference TTL. |
| `EMAIL_SDK_MCP_MAX_PENDING_VALIDATIONS` | `1000` | In-memory pending validation limit. |
| `EMAIL_SDK_MCP_APPROVAL_TIMEOUT_MS` | `60000` | Form elicitation timeout. |

## Tools

The default server exposes `email_configuration_status` and `email_validate`. Enabling send adds `email_send`, which accepts only an opaque validation reference and requires form elicitation approval for the exact stored email before the adapter is called. Tool outputs stay content-redacted; the approval form is the deliberate exception and shows the sanitized stored sender, recipients, subject, text body, and HTML body so a user can make an informed send decision.

| Tool | Network effect | Output |
| --- | --- | --- |
| `email_configuration_status` | None | Safe booleans, missing environment names, and policy limits. |
| `email_validate` | Calls Email SDK `validate`, never adapter `send` | A five-minute opaque reference, content-redacted counts, and warning count. |
| `email_send` | One irreversible adapter send after elicitation approval | Status, adapter, sanitized receipt id, and accepted/rejected counts. |

Validation references are random, immutable, single-use, bounded in memory, invalid after process restart, and bound to the exact message digest, adapter, sender, and policy version. A model-supplied confirmation string or repeated message is not approval. Text and HTML bodies are accepted only up to the approval-renderable body limit of 4,000 characters each; accepted bodies are displayed in full in the approval form with no preview truncation. Provider credentials and raw provider responses are never part of approval prompts or tool outputs.

## Adapter environment

Set `EMAIL_SDK_MCP_ADAPTER` to one built-in adapter name. The server creates exactly one adapter with `retry.maxAttempts: 1`, no fallback, and `telemetry: false`.

Common credentials:

| Adapter | Required environment |
| --- | --- |
| `resend` | `RESEND_API_KEY` |
| `postmark` | `POSTMARK_SERVER_TOKEN` |
| `sendgrid` | `SENDGRID_API_KEY` |
| `cloudflare` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `ses` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| `mailgun` | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` |
| `smtp` | `SMTP_HOST`; add `SMTP_USER` and `SMTP_PASS` together when SMTP auth is needed |

Run `email_configuration_status` after startup to see missing variables without testing credentials.

## Failure model

Policy denials, expired references, missing approval support, declined approval, cancelled approval, timeout, disabled send, adapter errors, route errors, and aborts are returned as structured failures. Ambiguous provider outcomes become `outcome_unknown`, and the MCP server does not advance to a fallback adapter.

Docs: https://email-sdk.dev/docs/integrations/agents/mcp
