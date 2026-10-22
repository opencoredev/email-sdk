import { describe, expect, test } from "bun:test";

import {
  EmailAbortError,
  EmailAdapterError,
  EmailAllRecipientsFailedError,
  EmailMiddlewareError,
  EmailRouteError,
  EmailValidationError,
} from "../errors.js";
import { toProviderError } from "../utils.js";
import {
  classifyAdapterFailure,
  classifySendFailure,
  findSdkDefect,
  type FailureKind,
} from "./failure-kind.js";

function withStatus(status: number) {
  return new EmailAdapterError(`resend failed with ${status}`, { adapter: "resend", status });
}

function thrownBy(adapter: string, cause: unknown) {
  const normalized = toProviderError(adapter, cause);

  if (!(normalized instanceof EmailAdapterError)) throw new Error("expected an adapter error");

  return normalized;
}

function systemError(message: string, fields: { code?: string; responseCode?: number }) {
  return Object.assign(new Error(message), fields);
}

describe("classifyAdapterFailure", () => {
  test.each<[number, FailureKind]>([
    [400, "rejected"],
    [401, "auth"],
    [403, "auth"],
    [404, "rejected"],
    [422, "rejected"],
    [429, "rate_limited"],
    [500, "provider_error"],
    [503, "provider_error"],
    // A provider answer the adapter turned into an error on purpose.
    [200, "rejected"],
  ])("HTTP %i is %s", (status, kind) => {
    expect(classifyAdapterFailure(withStatus(status))).toBe(kind);
  });

  test.each<[string, unknown, FailureKind]>([
    // Node's fetch, Bun's fetch, and Workers' fetch each fail differently.
    [
      "node fetch failed",
      Object.assign(new TypeError("fetch failed"), {
        cause: systemError("connect", { code: "ECONNREFUSED" }),
      }),
      "network",
    ],
    [
      "bun connection refused",
      Object.assign(new TypeError("Unable to connect."), { code: "ConnectionRefused" }),
      "network",
    ],
    ["workers connection lost", new TypeError("Network connection lost."), "network"],
    [
      "node fetch to a blocked port",
      Object.assign(new TypeError("fetch failed"), { cause: new Error("bad port") }),
      "network",
    ],
    // "network" inside a programming error's message is not a network failure.
    [
      "property named network",
      new TypeError("Cannot read properties of undefined (reading 'network')"),
      "unexpected",
    ],
    ["DNS failure", systemError("getaddrinfo ENOTFOUND", { code: "ENOTFOUND" }), "network"],
    ["request timeout", new DOMException("timed out", "TimeoutError"), "network"],
    ["SMTP auth", systemError("Invalid login: 535", { code: "EAUTH", responseCode: 535 }), "auth"],
    ["SMTP auth reply", systemError("Invalid login: 526", { responseCode: 530 }), "auth"],
    [
      "SMTP envelope",
      systemError("Recipient rejected", { code: "EENVELOPE", responseCode: 550 }),
      "rejected",
    ],
    ["SMTP socket", systemError("socket closed", { code: "ESOCKET" }), "network"],
    ["SMTP rate limit", systemError("too many", { code: "EMAXLIMIT" }), "rate_limited"],
    [
      "adapter bug",
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      "unexpected",
    ],
    ["bad recursion", new RangeError("Maximum call stack size exceeded"), "unexpected"],
    ["unparseable body", new SyntaxError("Unexpected token < in JSON"), "provider_error"],
    ["bad header on Node", new TypeError('Headers.append: "a b" is an invalid header name.'), "caller"],
    ["bad header on Bun", new TypeError("Header 'a' has invalid value"), "caller"],
    [
      "non-Latin-1 header on Node",
      new TypeError("Cannot convert argument to a ByteString because the character at index 0"),
      "caller",
    ],
    [
      "SDK bug that mentions headers",
      new TypeError("Cannot read properties of undefined (reading 'headers')"),
      "unexpected",
    ],
    ["plain provider SDK error", new Error("destination address not verified"), "rejected"],
    ["non-Error throw", "nope", "rejected"],
  ])("%s", (_label, cause, kind) => {
    expect(classifyAdapterFailure(thrownBy("resend", cause))).toBe(kind);
  });

  test("a throwing getter on the error cannot make classification throw", () => {
    const hostile = new Error("adapter failed");
    Object.defineProperty(hostile, "cause", {
      get() {
        throw new Error("getter exploded");
      },
    });

    expect(classifyAdapterFailure(new EmailAdapterError("failed", { adapter: "resend", cause: hostile }))).toBe(
      "rejected",
    );
  });

  test("a status wins over the cause", () => {
    const error = new EmailAdapterError("resend failed with 401", {
      adapter: "resend",
      status: 401,
      cause: new TypeError("Cannot read properties of undefined"),
    });

    expect(classifyAdapterFailure(error)).toBe("auth");
  });

  test.each([
    ["middleware", new EmailMiddlewareError("before_send", new TypeError("caller bug"))],
    ["validation", new EmailValidationError("bad message")],
    ["abort", new EmailAbortError()],
  ])("caller-owned %s failures are caller", (_label, cause) => {
    const wrapped = new EmailAdapterError(cause.message, { adapter: "resend", cause });

    expect(classifyAdapterFailure(wrapped)).toBe("caller");
  });
});

describe("findSdkDefect", () => {
  const isSdkOwned = (failure: EmailAdapterError) => failure.adapter !== "acme-internal";
  const defect = thrownBy("resend", new TypeError("Cannot read properties of undefined"));
  const auth = withStatus(401);

  test("finds the defect anywhere in a fallback route", () => {
    expect(findSdkDefect(new EmailRouteError([defect, auth]), isSdkOwned)).toBe(defect);
    expect(
      findSdkDefect(new EmailAllRecipientsFailedError([auth, defect]), isSdkOwned),
    ).toBe(defect);
  });

  test("ignores provider, network, and caller failures", () => {
    expect(findSdkDefect(new EmailRouteError([auth, withStatus(500)]), isSdkOwned)).toBe(
      undefined,
    );
    expect(findSdkDefect(new EmailValidationError("bad"), isSdkOwned)).toBe(undefined);
  });

  test("ignores bugs in caller-owned code", () => {
    const custom = thrownBy("acme-internal", new TypeError("caller adapter bug"));

    expect(findSdkDefect(custom, isSdkOwned)).toBe(undefined);
  });

  test("keeps core's own unexpected throws", () => {
    const core = thrownBy("unknown", new TypeError("core bug"));

    expect(findSdkDefect(core, isSdkOwned)).toBe(core);
  });
});

describe("classifySendFailure", () => {
  test("uses the last adapter failure, or caller when no adapter ran", () => {
    expect(classifySendFailure(new EmailRouteError([withStatus(500), withStatus(401)]))).toBe(
      "auth",
    );
    expect(classifySendFailure(new EmailValidationError("bad"))).toBe("caller");
  });
});
