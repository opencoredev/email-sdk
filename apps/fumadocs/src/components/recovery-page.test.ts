import { describe, expect, test } from "bun:test";

import { classifyRecoveryError, getErrorMessage } from "./recovery-page";

describe("recovery page helpers", () => {
  test("classifies stale chunk load failures", () => {
    expect(
      classifyRecoveryError(
        new Error(
          "error loading dynamically imported module: https://email-sdk.dev/assets/create-adapter-old.js",
        ),
      ),
    ).toBe("chunk");
  });

  test("classifies external DOM mutation failures", () => {
    expect(
      classifyRecoveryError(
        new Error(
          "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
        ),
      ),
    ).toBe("dom");
  });

  test("keeps unknown errors generic", () => {
    expect(classifyRecoveryError(new Error("Unexpected request failure"))).toBe("runtime");
  });

  test("extracts error messages safely", () => {
    expect(getErrorMessage("plain failure")).toBe("plain failure");
    expect(getErrorMessage({ message: "object failure" })).toBe("object failure");
    expect(getErrorMessage(null)).toBe("No error details were provided.");
  });
});
