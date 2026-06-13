import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { EmailProviderError, EmailProviderNotFoundError, EmailValidationError } from "./errors.js";
import {
  TELEMETRY_NOTICE,
  createTelemetry,
  detectCiVendor,
  isReportableSendError,
  normalizeAdapterName,
} from "./telemetry.js";

type CapturedRequest = {
  url: string;
  body: {
    api_key: string;
    event: string;
    distinct_id: string;
    properties: Record<string, unknown>;
  };
};

function fetchCapture() {
  const calls: CapturedRequest[] = [];
  const fetchFn = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  return { calls, fetchFn };
}

function tempConfigDir() {
  return join(mkdtempSync(join(tmpdir(), "email-sdk-telemetry-")), "email-sdk");
}

describe("telemetry opt-out", () => {
  test.each(["0", "false", "off", "OFF"])(
    "EMAIL_SDK_TELEMETRY=%s disables capture",
    async (value) => {
      const { calls, fetchFn } = fetchCapture();
      const notices: string[] = [];
      const telemetry = createTelemetry({
        env: { EMAIL_SDK_TELEMETRY: value },
        fetch: fetchFn,
        configDir: tempConfigDir(),
        notify: (message) => notices.push(message),
      });

      expect(telemetry.enabled).toBe(false);
      await telemetry.capture("cli command run", { command: "help" });
      expect(calls).toHaveLength(0);
      expect(notices).toHaveLength(0);
    },
  );

  test.each(["1", "true"])("DO_NOT_TRACK=%s disables capture", (value) => {
    const telemetry = createTelemetry({
      env: { DO_NOT_TRACK: value },
      configDir: tempConfigDir(),
      notify: () => {},
    });

    expect(telemetry.enabled).toBe(false);
  });

  test("NODE_ENV=test disables capture", () => {
    const telemetry = createTelemetry({
      env: { NODE_ENV: "test" },
      configDir: tempConfigDir(),
      notify: () => {},
    });

    expect(telemetry.enabled).toBe(false);
  });
});

describe("telemetry capture", () => {
  test("posts anonymous events to PostHog with common properties", async () => {
    const { calls, fetchFn } = fetchCapture();
    const telemetry = createTelemetry({
      env: {},
      fetch: fetchFn,
      configDir: tempConfigDir(),
      notify: () => {},
      sdkVersion: "1.2.3",
    });

    expect(telemetry.enabled).toBe(true);
    await telemetry.capture("email sent", { adapter: "resend", success: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://us.i.posthog.com/capture/");
    expect(calls[0]?.body.api_key).toStartWith("phc_");
    expect(calls[0]?.body.event).toBe("email sent");
    expect(calls[0]?.body.distinct_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]?.body.properties).toMatchObject({
      adapter: "resend",
      success: true,
      sdk_version: "1.2.3",
      platform: process.platform,
      $process_person_profile: false,
    });
  });

  test("keeps a stable anonymous id across instances", async () => {
    const configDir = tempConfigDir();
    const first = fetchCapture();
    const second = fetchCapture();

    await createTelemetry({
      env: {},
      fetch: first.fetchFn,
      configDir,
      notify: () => {},
    }).capture("client created");
    await createTelemetry({
      env: {},
      fetch: second.fetchFn,
      configDir,
      notify: () => {},
    }).capture("client created");

    expect(first.calls[0]?.body.distinct_id).toBe(second.calls[0]?.body.distinct_id as string);
  });

  test("flush waits for in-flight captures", async () => {
    const calls: CapturedRequest[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchFn = (async (url: URL | RequestInfo, init?: RequestInit) => {
      await gate;
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const telemetry = createTelemetry({
      env: {},
      fetch: fetchFn,
      configDir: tempConfigDir(),
      notify: () => {},
    });

    void telemetry.capture("client created");
    void telemetry.capture("email sent", { adapter: "resend", success: true });
    expect(calls).toHaveLength(0);

    release?.();
    await telemetry.flush();

    expect(calls).toHaveLength(2);
  });

  test("never throws when delivery fails", async () => {
    const telemetry = createTelemetry({
      env: {},
      fetch: (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch,
      configDir: tempConfigDir(),
      notify: () => {},
    });

    await expect(
      telemetry.capture("cli command run", { command: "send" }),
    ).resolves.toBeUndefined();
  });
});

describe("telemetry notice", () => {
  test("prints the opt-out notice once and persists the marker", () => {
    const configDir = tempConfigDir();
    const notices: string[] = [];
    const options = {
      env: {},
      fetch: fetchCapture().fetchFn,
      configDir,
      notify: (message: string) => notices.push(message),
    };

    createTelemetry(options);
    createTelemetry(options);

    expect(notices).toEqual([TELEMETRY_NOTICE]);
    expect(notices[0]).toContain("EMAIL_SDK_TELEMETRY=0");

    const state = JSON.parse(readFileSync(join(configDir, "telemetry.json"), "utf8")) as {
      noticeShown: boolean;
    };
    expect(state.noticeShown).toBe(true);
  });
});

function exceptionTelemetry() {
  const { calls, fetchFn } = fetchCapture();
  const telemetry = createTelemetry({
    env: {},
    fetch: fetchFn,
    configDir: tempConfigDir(),
    notify: () => {},
  });

  return { calls, telemetry };
}

type ExceptionListItem = {
  type: string;
  value: string;
  mechanism: { handled: boolean; type: string; synthetic: boolean };
  stacktrace?: { type: string; frames: Array<Record<string, unknown>> };
};

function exceptionList(call: CapturedRequest | undefined) {
  return (call?.body.properties.$exception_list ?? []) as ExceptionListItem[];
}

describe("telemetry exceptions", () => {
  test("posts $exception events with sanitized raw stack frames", async () => {
    const { calls, telemetry } = exceptionTelemetry();
    const error = new EmailProviderError("request failed", { provider: "resend" });
    error.stack = [
      "EmailProviderError: request failed",
      "    at sendWithRetry (/Users/leo/projects/app/node_modules/@opencoredev/email-sdk/dist/core.js:280:13)",
      "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
      "    at async runMailer (/Users/leo/app/src/mailer.ts:42:9)",
    ].join("\n");

    await telemetry.captureException(error, {
      source: "sdk",
      handled: true,
      adapter: "resend",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.event).toBe("$exception");
    expect(calls[0]?.body.properties).toMatchObject({
      $exception_level: "error",
      $exception_fingerprint: "EmailProviderError:provider_error",
      error_name: "EmailProviderError",
      error_code: "provider_error",
      source: "sdk",
      handled: true,
      adapter: "resend",
      $process_person_profile: false,
    });

    const [item] = exceptionList(calls[0]);
    expect(item?.type).toBe("EmailProviderError");
    expect(item?.mechanism).toEqual({ handled: true, type: "generic", synthetic: false });
    expect(item?.stacktrace?.type).toBe("raw");

    // Frames are Sentry-ordered: outermost call first, throw site last.
    const frames = item?.stacktrace?.frames ?? [];
    expect(frames).toHaveLength(3);
    expect(frames[0]).toMatchObject({
      platform: "node:javascript",
      function: "async runMailer",
      filename: "mailer.ts",
      lineno: 42,
      colno: 9,
      in_app: false,
    });
    expect(frames[1]).toMatchObject({ filename: "node:internal/process/task_queues" });
    expect(frames.at(-1)).toMatchObject({
      filename: "node_modules/@opencoredev/email-sdk/dist/core.js",
      function: "sendWithRetry",
      in_app: true,
    });
  });

  test.each([
    ["sent to leo@example.com today", "sent to <email> today"],
    ["fetch https://api.resend.com/emails?x=1 failed", "fetch <url> failed"],
    ['Unknown adapter "acme-internal".', 'Unknown adapter "<redacted>".'],
    ["bad value 'super secret'", "bad value '<redacted>'"],
    ["template `welcome email` missing", "template `<redacted>` missing"],
    ["key re_AbCdEfGhIjKlMnOpQrStUvWx12 rejected", "key <token> rejected"],
    // Base64 secrets ending in "=" padding must redact whole, not leak the tail.
    ["auth dXNlcjpzdXBlcnNlY3JldA== bad", "auth <token> bad"],
    ["basic YWxhZGRpbjpvcGVuc2VzYW1l== denied", "basic <token> denied"],
    ["read /home/leo/app/.env first", "read ~/app/.env first"],
    // A long alphanumeric username must collapse to "~" before TOKEN_PATTERN runs,
    // never leak as "/home/<token>".
    ["spawn /home/abcdefghijklmnopqrstuvwx/bin", "spawn ~/bin"],
  ])("redacts %j", async (input, expected) => {
    const { calls, telemetry } = exceptionTelemetry();
    const error = new Error(input);
    error.stack = undefined;

    await telemetry.captureException(error, { source: "cli", handled: false });

    expect(exceptionList(calls[0])[0]?.value).toBe(expected);
  });

  test("never throws on a hostile non-string stack", async () => {
    const { calls, telemetry } = exceptionTelemetry();
    const error = new Error("boom");
    // Some Error subclasses overwrite stack with a non-string.
    Object.defineProperty(error, "stack", { value: { frames: [] } });

    await expect(
      telemetry.captureException(error, { source: "sdk", handled: true }),
    ).resolves.toBeUndefined();

    const [item] = exceptionList(calls[0]);
    expect(item?.value).toBe("boom");
    expect(item?.stacktrace).toBeUndefined();
  });

  test("never throws when reading the error throws", async () => {
    const { calls, telemetry } = exceptionTelemetry();
    const error = new Error("trap");
    Object.defineProperty(error, "stack", {
      get() {
        throw new Error("stack getter exploded");
      },
    });

    await expect(
      telemetry.captureException(error, { source: "sdk", handled: true }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("replaces the current home directory and truncates long messages", async () => {
    const { calls, telemetry } = exceptionTelemetry();
    const error = new Error(`ENOENT ${homedir()}/mail.json ${"lorem ipsum ".repeat(40)}`);
    error.stack = undefined;

    await telemetry.captureException(error, { source: "sdk", handled: true });

    const value = exceptionList(calls[0])[0]?.value ?? "";
    expect(value).toContain("ENOENT ~/mail.json");
    expect(value).not.toContain(homedir());
    expect(value).toHaveLength(301);
    expect(value.endsWith("…")).toBe(true);
  });

  test("walks cause chains and marks non-Error throws synthetic", async () => {
    const { calls, telemetry } = exceptionTelemetry();
    const root = new Error("root");
    root.stack = undefined;
    const middle = new Error("middle", { cause: root });
    middle.stack = undefined;
    const top = new Error("top", { cause: middle });
    top.stack = undefined;

    await telemetry.captureException(top, { source: "sdk", handled: true });
    await telemetry.captureException("string failure", { source: "sdk", handled: false });

    const chained = exceptionList(calls[0]);
    expect(chained.map((item) => item.value)).toEqual(["top", "middle", "root"]);
    expect(calls[0]?.body.properties.$exception_fingerprint).toBeUndefined();

    const synthetic = exceptionList(calls[1]);
    expect(synthetic[0]?.mechanism.synthetic).toBe(true);
    expect(synthetic[0]?.type).toBe("Error");
  });

  test("dedupes by error object, error class, and process budget", async () => {
    const { calls, telemetry } = exceptionTelemetry();
    const error = new Error("same object");
    error.stack = undefined;

    await telemetry.captureException(error, { source: "sdk", handled: true });
    await telemetry.captureException(error, { source: "cli", handled: false });
    expect(calls).toHaveLength(1);

    const sibling = new Error("same object");
    sibling.stack = undefined;
    await telemetry.captureException(sibling, { source: "sdk", handled: true });
    expect(calls).toHaveLength(1);

    for (let index = 0; index < 8; index += 1) {
      const distinct = new Error(`distinct ${index}`);
      distinct.stack = undefined;
      distinct.name = `Error${index}`;
      await telemetry.captureException(distinct, { source: "sdk", handled: true });
    }

    expect(calls).toHaveLength(5);
  });

  test("does nothing when telemetry is disabled", async () => {
    const { calls, fetchFn } = fetchCapture();
    const telemetry = createTelemetry({
      env: { EMAIL_SDK_TELEMETRY: "0" },
      fetch: fetchFn,
      configDir: tempConfigDir(),
      notify: () => {},
    });

    await expect(
      telemetry.captureException(new Error("boom"), { source: "sdk", handled: true }),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("isReportableSendError", () => {
  test("excludes caller usage errors", () => {
    expect(isReportableSendError(new EmailValidationError("bad message"))).toBe(false);
    expect(isReportableSendError(new EmailProviderNotFoundError("acme"))).toBe(false);
  });

  test("includes provider failures and unknown throws", () => {
    expect(isReportableSendError(new EmailProviderError("boom", {}))).toBe(true);
    expect(isReportableSendError(new Error("boom"))).toBe(true);
  });
});

describe("detectCiVendor", () => {
  test.each([
    [{ GITHUB_ACTIONS: "true" }, "github_actions"],
    [{ GITLAB_CI: "true" }, "gitlab"],
    [{ CIRCLECI: "true" }, "circleci"],
    [{ JENKINS_URL: "https://ci.example.com" }, "jenkins"],
    [{ TRAVIS: "true" }, "travis"],
    [{ BUILDKITE: "true" }, "buildkite"],
    [{ VERCEL: "1" }, "vercel"],
    [{ CI: "true" }, "generic"],
    [{ CI: "1" }, "generic"],
  ])("detects %o as %s", (env, vendor) => {
    expect(detectCiVendor(env)).toBe(vendor);
  });

  test("returns undefined outside CI and stamps common properties", async () => {
    expect(detectCiVendor({})).toBeUndefined();

    const { calls, fetchFn } = fetchCapture();
    const telemetry = createTelemetry({
      env: { GITHUB_ACTIONS: "true" },
      fetch: fetchFn,
      configDir: tempConfigDir(),
      notify: () => {},
    });

    await telemetry.capture("cli command run", { command: "send" });
    expect(calls[0]?.body.properties).toMatchObject({ ci: true, ci_vendor: "github_actions" });
  });
});

describe("normalizeAdapterName", () => {
  test("keeps built-in adapter names", () => {
    expect(normalizeAdapterName("resend")).toBe("resend");
    expect(normalizeAdapterName("smtp")).toBe("smtp");
  });

  test("masks custom adapter names", () => {
    expect(normalizeAdapterName("acme-internal-mailer")).toBe("custom");
  });

  test("maps missing names to unknown", () => {
    expect(normalizeAdapterName(undefined)).toBe("unknown");
  });
});
