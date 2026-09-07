import { defineComponent } from "convex/server";
import { v } from "convex/values";

import type { ConvexEmailEnvVar } from "../shared/adapters.js";

/**
 * Every adapter credential the component may read. The list stays spelled out so `convex codegen`
 * can derive the `Env` type and so readers of the component contract see it without running code;
 * the `satisfies` clause fails the build if it drifts from `CONVEX_EMAIL_ADAPTERS` in either
 * direction.
 */
const env = {
  AWS_ACCESS_KEY_ID: v.optional(v.string()),
  AWS_REGION: v.optional(v.string()),
  AWS_SECRET_ACCESS_KEY: v.optional(v.string()),
  AWS_SESSION_TOKEN: v.optional(v.string()),
  BREVO_API_KEY: v.optional(v.string()),
  CLOUDFLARE_ACCOUNT_ID: v.optional(v.string()),
  CLOUDFLARE_API_TOKEN: v.optional(v.string()),
  ITERABLE_API_KEY: v.optional(v.string()),
  ITERABLE_CAMPAIGN_ID: v.optional(v.string()),
  JETEMAIL_API_KEY: v.optional(v.string()),
  LETTERMINT_API_TOKEN: v.optional(v.string()),
  LETTERMINT_ROUTE: v.optional(v.string()),
  LETTR_API_KEY: v.optional(v.string()),
  LOOPS_API_KEY: v.optional(v.string()),
  LOOPS_TRANSACTIONAL_ID: v.optional(v.string()),
  MAILCHIMP_API_KEY: v.optional(v.string()),
  MAILERSEND_API_KEY: v.optional(v.string()),
  MAILGUN_API_KEY: v.optional(v.string()),
  MAILGUN_DOMAIN: v.optional(v.string()),
  MAILPACE_API_KEY: v.optional(v.string()),
  MAILTRAP_API_KEY: v.optional(v.string()),
  PLUNK_API_KEY: v.optional(v.string()),
  POSTMARK_SERVER_TOKEN: v.optional(v.string()),
  PRIMITIVE_API_KEY: v.optional(v.string()),
  RESEND_API_KEY: v.optional(v.string()),
  SCALEWAY_PROJECT_ID: v.optional(v.string()),
  SCALEWAY_REGION: v.optional(v.string()),
  SCALEWAY_SECRET_KEY: v.optional(v.string()),
  SENDGRID_API_KEY: v.optional(v.string()),
  SEQUENZY_API_KEY: v.optional(v.string()),
  SMTP_HOST: v.optional(v.string()),
  SMTP_PASS: v.optional(v.string()),
  SMTP_PORT: v.optional(v.string()),
  SMTP_SECURE: v.optional(v.string()),
  SMTP_USER: v.optional(v.string()),
  SPARKPOST_API_KEY: v.optional(v.string()),
  UNOSEND_API_KEY: v.optional(v.string()),
  ZEPTOMAIL_TOKEN: v.optional(v.string()),
} satisfies Record<ConvexEmailEnvVar, unknown>;

export default defineComponent("convexEmail", { env });
