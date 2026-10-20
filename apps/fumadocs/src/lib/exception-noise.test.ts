import { describe, expect, test } from "bun:test";

import type { CaptureResult, Property } from "posthog-js";

import { capturedExceptionList, isBrowserNoiseException } from "./exception-noise";

describe("isBrowserNoiseException", () => {
  test.each([
    ["cross-origin script error", [{ value: "Script error." }]],
    [
      "in-app browser bridge",
      [{ value: "undefined is not an object (evaluating 'window.webkit.messageHandlers.x')" }],
    ],
    [
      "extension messaging",
      [{ value: "'Error' captured as exception with message: 'No Listener: tabs:outgoing'" }],
    ],
    [
      "extension frames only",
      [
        {
          value: "boom",
          stacktrace: { frames: [{ filename: "chrome-extension://abc/content.js" }] },
        },
      ],
    ],
  ])("drops %s", (_label, list) => {
    expect(isBrowserNoiseException(list)).toBe(true);
  });

  test.each([
    [
      "a site error",
      [
        {
          value: "Cannot read properties of undefined",
          stacktrace: { frames: [{ filename: "/assets/main.js" }] },
        },
      ],
    ],
    ["a site error without frames", [{ value: "Maximum call stack size exceeded." }]],
    ["an empty list", []],
  ])("keeps %s", (_label, list) => {
    expect(isBrowserNoiseException(list)).toBe(false);
  });
});

describe("capturedExceptionList", () => {
  function captured(event: string, list: Property): CaptureResult {
    return { uuid: "1", event, properties: { $exception_list: list } };
  }

  test("reads exception events and skips everything else", () => {
    expect(capturedExceptionList(captured("$exception", [{ value: "x" }]))).toEqual([
      { value: "x" },
    ]);
    expect(capturedExceptionList(captured("$pageview", [{ value: "x" }]))).toBeUndefined();
    expect(capturedExceptionList(captured("$exception", "nope"))).toBeUndefined();
  });
});
