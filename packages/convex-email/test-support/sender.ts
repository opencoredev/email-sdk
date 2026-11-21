/**
 * Test-only wiring for running the component as the root of a `convex-test` instance. A real app
 * exports the sender from its own `"use node"` file; here it is one extra module whose action calls
 * the component's lease mutations as `lib:<name>`, which is where they live when the component is
 * the root.
 */
import { anyApi, createFunctionHandle, makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";

import schema from "../src/component/schema.js";
import { emailSender } from "../src/node/index.js";
import type { ConvexEmailComponentApi } from "../src/shared/componentApi.js";
import { modules as componentModules } from "../src/testing.js";

const rootComponent: ConvexEmailComponentApi = anyApi;

export const modules = {
  ...componentModules,
  "./component/testSender.ts": async () => ({ send: emailSender(rootComponent) }),
};

const senderReference = makeFunctionReference<"action", { emailId: string }, null>("testSender:send");

/** The function handle the app-side client would pass with every enqueue. */
export const SENDER = await convexTest(schema, modules).run(
  async () => await createFunctionHandle(senderReference),
);
