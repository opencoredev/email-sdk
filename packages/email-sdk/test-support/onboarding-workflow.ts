import { z } from "zod";

import type { EmailMessage } from "../src/types.js";
import { defineWorkflow } from "../src/workflows.js";

const from = "Acme <hello@acme.com>";

function message(to: string, subject: string, text: string): EmailMessage {
  return { from, to, subject, text };
}

/** The examples/onboarding-drip workflow, for CLI tests that import a module by path. */
export const onboarding = defineWorkflow({
  name: "onboarding",
  cancelOn: ["unsubscribed"],
  input: z.object({ email: z.string(), name: z.string().default("there") }),
  run: async (ctx, input) => {
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

export const notAWorkflow = { name: "nope" };
