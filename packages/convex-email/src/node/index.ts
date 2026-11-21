/**
 * The app-side half of Convex Email. Convex rejects `"use node"` modules inside components, so
 * provider requests (SMTP, attachment fetching, every HTTP adapter) run in an action the app
 * exports from its own `"use node"` file:
 *
 * ```ts
 * // convex/emailSender.ts
 * "use node";
 * import { emailSender } from "@opencoredev/convex-email/node";
 * import { components } from "./_generated/api";
 *
 * export const send = emailSender(components.convexEmail);
 * ```
 *
 * Pass `internal.emailSender.send` as the `sender` option of `ConvexEmail`.
 */
import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";

import { senderArgs } from "../component/functionRefs.js";
import type { ConvexEmailEnvVar } from "../shared/adapters.js";
import type { ConvexEmailComponentApi } from "../shared/componentApi.js";
import { processEmail } from "./worker.js";

export type ConvexEmailSenderOptions = {
  /**
   * Email SDK telemetry for sends from this action. `false` turns it off; otherwise the SDK
   * follows `EMAIL_SDK_TELEMETRY` and `DO_NOT_TRACK` in the deployment environment.
   */
  telemetry?: boolean;
  /**
   * Maps differently named secrets onto the credential names Convex Email reads, for example when
   * two component instances use different Resend keys. Called on every send, so read
   * `process.env` inside it. Variables it leaves out fall back to `process.env`.
   *
   * ```ts
   * emailSender(components.marketingEmail, {
   *   env: () => ({ RESEND_API_KEY: process.env.MARKETING_RESEND_API_KEY }),
   * });
   * ```
   */
  env?: () => Partial<Record<ConvexEmailEnvVar, string | undefined>>;
};

/**
 * Builds the internal action that sends queued email. Export it from a `"use node"` file in your
 * Convex app and pass its reference to `new ConvexEmail(component, { sender })`.
 */
export function emailSender(
  component: ConvexEmailComponentApi,
  options: ConvexEmailSenderOptions = {},
) {
  return internalActionGeneric({
    args: senderArgs,
    returns: v.null(),
    handler: async (ctx, args) => {
      await processEmail({
        ctx,
        component,
        emailId: args.emailId,
        telemetry: options.telemetry,
        env: options.env ? { ...process.env, ...options.env() } : undefined,
      });

      return null;
    },
  });
}
