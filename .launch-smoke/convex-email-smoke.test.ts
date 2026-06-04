import { describe, expect, test } from "bun:test";

import { ConvexEmail } from "@opencoredev/convex-email";
import * as generatedComponent from "@opencoredev/convex-email/_generated/component";
import convexEmail from "@opencoredev/convex-email/convex.config.js";
import componentHelpers, { memoryAdapter, registerConvexEmail } from "@opencoredev/convex-email/test";

describe("convex-email package exports", () => {
  test("resolves public client, component config, and test helpers", () => {
    expect(typeof ConvexEmail).toBe("function");
    expect(typeof generatedComponent).toBe("object");
    expect(typeof convexEmail).toBe("object");
    expect(memoryAdapter("mailbox")).toEqual({ kind: "memory", name: "mailbox" });
    expect(typeof registerConvexEmail).toBe("function");
    expect(typeof componentHelpers.registerConvexEmail).toBe("function");
  });
});
