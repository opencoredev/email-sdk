/**
 * Test-only wiring for running the component as the root of a `convex-test` instance. A real app
 * exports the sender from its own `"use node"` file; here it is one extra module whose action calls
 * the component's lease mutations as `lib:<name>`, which is where they live when the component is
 * the root.
 */
import { anyApi, createFunctionHandle, internalActionGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";

import schema from "../src/component/schema.js";
import { emailSender } from "../src/node/index.js";
import type { ConvexEmailComponentApi } from "../src/shared/componentApi.js";
import { modules as componentModules } from "../src/testing.js";

const rootComponent: ConvexEmailComponentApi = anyApi;

/** Email ids the replacement sender was called with, in order. */
export const replacementSenderCalls: string[] = [];

/** Stands in for a sender action the app renamed or moved; it only records that it ran. */
const replacementSender = internalActionGeneric({
  args: { emailId: v.string() },
  returns: v.null(),
  handler: async (_ctx, args) => {
    replacementSenderCalls.push(args.emailId);

    return null;
  },
});

export const modules = {
  ...componentModules,
  "./component/testSender.ts": async () => ({ send: emailSender(rootComponent) }),
  "./component/renamedSender.ts": async () => ({ send: replacementSender }),
  "./component/brokenEnvSender.ts": async () => ({
    send: emailSender(rootComponent, {
      env: () => {
        throw new Error("Secret store unavailable.");
      },
    }),
  }),
  "./component/mappedSender.ts": async () => ({
    send: emailSender(rootComponent, { env: () => ({ RESEND_API_KEY: process.env.MAPPED_RESEND_KEY }) }),
  }),
};

async function handleFor(path: string) {
  const reference = makeFunctionReference<"action", { emailId: string }, null>(path);

  return await convexTest(schema, modules).run(async () => await createFunctionHandle(reference));
}

/** The function handle the app-side client would pass with every enqueue. */
export const SENDER = await handleFor("testSender:send");

/** The handle of the replacement sender, as a client would pass it after a rename. */
export const RENAMED_SENDER = await handleFor("renamedSender:send");

/** A sender whose `env` mapping throws on every send. */
export const BROKEN_ENV_SENDER = await handleFor("brokenEnvSender:send");

/** A sender that maps `MAPPED_RESEND_KEY` onto `RESEND_API_KEY`. */
export const MAPPED_SENDER = await handleFor("mappedSender:send");
