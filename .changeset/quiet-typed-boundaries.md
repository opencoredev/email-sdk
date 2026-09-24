---
"@opencoredev/email-sdk": minor
---

Tighten types at the SDK's input boundaries.

- `createEmailAgentTools` now returns a named `EmailAgentTools` type. `sendEmail.parameters` is typed as a JSON object, and `sendEmail.execute` resolves to `EmailSendResult` instead of `unknown`.
- `NormalizedWebhookEvent.payload` is typed as a parsed JSON object instead of `Record<string, unknown>`.
- `JsonObject` and `JsonValue` are exported from the `webhooks` and `agent-tools` entry points so these types can be named.
- The compat `EmailRetryConfig.delay` and `shouldRetry` callbacks now receive the `EmailSdkError` the client already passed them at runtime.
- Send-option `metadata` (on `send()` options, hook events, adapter contexts, and the capture and observability plugins) is now typed as `EmailSendMetadata`. By default that is `EmailMetadataRecord`: strings, numbers, booleans, `null`, `undefined`, `Date`, and arrays or plain objects of those. Metadata that holds class instances, functions, or values typed by an `interface` no longer type-checks; spread it into a plain object or register your own shape.
- To give metadata your own shape, augment `EmailMetadataRegister`:

  ```ts
  declare module "@opencoredev/email-sdk" {
    interface EmailMetadataRegister {
      metadata: { tenantId: string };
    }
  }
  ```

  Hooks and plugins then see `event.metadata?.tenantId` as a `string`.
- Iterable `dataFields` is typed as `EmailMetadataRecord`, and the SMTP `tls` option now uses nodemailer's own TLS options type.
- Provider responses are now parsed through shared JSON helpers. Malformed or `null` success bodies are treated like empty bodies, and non-string entries in accepted or rejected recipient lists are ignored instead of passed through.
