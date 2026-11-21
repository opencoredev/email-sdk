---
"@opencoredev/convex-email": major
---

Make the component deployable. Convex rejects `"use node"` modules inside components, and 5.0.0 shipped three, so `convex dev` and `convex deploy` refused every app that mounted it. The component now runs entirely in Convex's default runtime and keeps the queue, retries, cleanup, and webhook records. Provider requests, SMTP, and URL attachment fetching move into a sender action your app exports from a `"use node"` file with `emailSender()` from the new `@opencoredev/convex-email/node` entry, and `new ConvexEmail()` takes it as the required `sender` option. Adapter credentials are read from the deployment environment, so the component no longer declares environment variables and `app.use(convexEmail, { env })` mappings must be removed. `emailSender(component, { telemetry: false })` turns off Email SDK telemetry for component sends.

Before:

```ts
// convex/convex.config.ts
app.use(convexEmail, { env: { RESEND_API_KEY: app.env.RESEND_API_KEY } });

// convex/email.ts
export const email = new ConvexEmail(components.convexEmail, {
  adapters: [{ kind: "resend" }],
});
```

After:

```ts
// convex/convex.config.ts
app.use(convexEmail);

// convex/emailSender.ts
"use node";
import { emailSender } from "@opencoredev/convex-email/node";
import { components } from "./_generated/api";
export const send = emailSender(components.convexEmail);

// convex/email.ts
export const email: ConvexEmail = new ConvexEmail(components.convexEmail, {
  sender: internal.emailSender.send,
  adapters: [{ kind: "resend" }],
});
```
