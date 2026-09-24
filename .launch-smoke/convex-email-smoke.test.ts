import { describe, expect, test } from "bun:test";

import { ConvexEmail } from "@opencoredev/convex-email";
import * as generatedComponent from "@opencoredev/convex-email/_generated/component";
import convexEmail from "@opencoredev/convex-email/convex.config.js";
import componentHelpers, { memoryAdapter, registerConvexEmail } from "@opencoredev/convex-email/test";

describe("convex-email package exports", () => {
  test("resolves public client, component config, and test helpers", () => {
    expect(ConvexEmail).toBeInstanceOf(Function);
    expect(generatedComponent).toBeDefined();
    expect(convexEmail).toBeInstanceOf(Object);
    expect(memoryAdapter("mailbox")).toEqual({ kind: "memory", name: "mailbox" });
    expect(registerConvexEmail).toBeInstanceOf(Function);
    expect(componentHelpers.registerConvexEmail).toBeInstanceOf(Function);
  });
});
