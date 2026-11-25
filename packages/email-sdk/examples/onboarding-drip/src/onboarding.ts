import type { EmailMessage } from "@opencoredev/email-sdk";
import { defineWorkflow } from "@opencoredev/email-sdk/workflows";
import type { WorkflowEngine } from "@opencoredev/email-sdk/workflows";

export type OnboardingInput = { userId: string; email: string; name: string };

const from = "Acme <hello@acme.com>";

function message(to: string, subject: string, text: string): EmailMessage {
  return { from, to, subject, text };
}

/**
 * Day 0 welcome, a tip on day 2, then either a "you're set" email when the user activates or a
 * nudge after three more days. Unsubscribing cancels the run wherever it is.
 */
export const onboarding = defineWorkflow({
  name: "onboarding",
  cancelOn: ["unsubscribed"],
  run: async (ctx, input: OnboardingInput) => {
    await ctx.send("welcome", message(input.email, `Welcome, ${input.name}`, "Your account is ready."));
    await ctx.sleep("before-tip", "2d");
    await ctx.send("tip", message(input.email, "One tip to get started", "Invite a teammate."));

    const activated = await ctx.waitForEvent<{ plan: string }>("activated", { timeout: "3d" });

    if (activated.status === "received") {
      await ctx.send("activated-mail", message(input.email, "You're all set", `Enjoy the ${activated.payload.plan} plan.`));

      return { outcome: "activated" };
    }

    await ctx.send("nudge", message(input.email, "Need a hand?", "Reply to this email and we'll help."));

    return { outcome: "nudged" };
  },
});

/** Call from your signup handler. The run id makes repeated signup webhooks start one drip. */
export async function startOnboarding(engine: WorkflowEngine, input: OnboardingInput) {
  return await engine.start(onboarding, input, { id: `onboarding:${input.userId}`, subject: input.email });
}

/** Call from your product when the user finishes setup. */
export async function markActivated(engine: WorkflowEngine, email: string, plan: string) {
  return await engine.sendEvent({ name: "activated", subject: email, payload: { plan } });
}

/** Call from your unsubscribe link or list-unsubscribe webhook. */
export async function unsubscribe(engine: WorkflowEngine, email: string) {
  return await engine.sendEvent({ name: "unsubscribed", subject: email });
}
