import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TELEMETRY_NOTICE, createTelemetry, normalizeAdapterName } from "./telemetry.js";

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
