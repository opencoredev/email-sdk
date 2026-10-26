/**
 * The onboarding drip from the email workflows guide, with HTML bodies so the viewer can preview
 * each email. Build-time only: scripts/generate-workflow-viewer.ts inspects it and runs it on an
 * in-memory engine, and the client bundle only sees the generated snapshot.
 */
import type { EmailMessage } from "@opencoredev/email-sdk";
import { defineWorkflow } from "@opencoredev/email-sdk/workflows";

export type OnboardingInput = { userId: string; email: string; name: string };

type Tip = { title: string; body: string };

const from = "Acme <hello@acme.com>";

function message(to: string, subject: string, paragraphs: readonly string[]): EmailMessage {
  const html = [
    '<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#14130f;line-height:1.55">',
    '<p style="font-weight:700;font-size:15px;margin:0 0 24px">Acme</p>',
    `<h1 style="font-size:22px;line-height:1.25;margin:0 0 16px">${subject}</h1>`,
    ...paragraphs.map((text) => `<p style="font-size:15px;margin:0 0 14px">${text}</p>`),
    '<p style="font-size:12px;color:#6b6960;margin:28px 0 0">You get this because you signed up for Acme. <a href="https://acme.example/unsubscribe" style="color:#6b6960">Unsubscribe</a></p>',
    "</div>",
  ].join("");

  return { from, to, subject, text: paragraphs.join("\n\n"), html };
}

/** Picks the day-2 tip. A real app would read the user's setup progress here. */
function pickTip(input: OnboardingInput): Tip {
  return { title: "Invite a teammate", body: `${input.name}, workspaces with two people get set up twice as fast.` };
}

export const onboarding = defineWorkflow({
  name: "onboarding",
  cancelOn: ["unsubscribed"],
  run: async (ctx, input: OnboardingInput) => {
    await ctx.send("welcome", message(input.email, `Welcome, ${input.name}`, ["Your account is ready.", "Reply to this email if anything looks off."]));
    await ctx.sleep("before-tip", "2d");

    const tip = await ctx.step("pick-tip", () => pickTip(input));

    await ctx.send("tip", message(input.email, `Tip: ${tip.title}`, [tip.body]));

    const activated = await ctx.waitForEvent<{ plan: string }>("activated", { timeout: "3d" });

    if (activated.status === "received") {
      await ctx.send("activated-mail", message(input.email, "You're all set", [`Enjoy the ${activated.payload.plan} plan.`]));

      return { outcome: "activated" };
    }

    await ctx.send("nudge", message(input.email, "Need a hand?", ["Reply to this email and we'll help you finish setup."]));

    return { outcome: "nudged" };
  },
});

/** The sample values the viewer and the guide's CLI example use. */
export const onboardingSample = {
  input: { userId: "u_1", email: "ada@example.com", name: "Ada" },
  events: { activated: { plan: "pro" } },
  steps: { "pick-tip": { title: "Invite a teammate", body: "Ada, workspaces with two people get set up twice as fast." } },
} as const satisfies { input: OnboardingInput; events: Record<string, { plan: string }>; steps: Record<string, Tip> };
