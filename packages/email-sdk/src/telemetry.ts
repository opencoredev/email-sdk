import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUPPORTED_MESSAGE_FIELDS } from "./utils.js";

const POSTHOG_HOST = "https://us.i.posthog.com";
// Public write-only project key. It can only ingest events, never read data.
const POSTHOG_PROJECT_KEY = "phc_D62r4m5ivBr6LPCBqjKHg8GL6QTxT57LTzKrmkg5hNZS";
const CAPTURE_TIMEOUT_MS = 3_000;

export const TELEMETRY_NOTICE = `@opencoredev/email-sdk collects anonymous usage analytics: adapter names, command names, and success/failure counts. Email content, addresses, and credentials are never collected. Opt out with EMAIL_SDK_TELEMETRY=0 or DO_NOT_TRACK=1. Details: https://github.com/opencoredev/email-sdk#telemetry`;

export type TelemetryEventName = "client created" | "email sent" | "cli command run";

export type TelemetryProperties = Record<
  string,
  string | number | boolean | readonly string[] | undefined
>;

export type TelemetryOptions = {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  configDir?: string;
  notify?: (message: string) => void;
  sdkVersion?: string;
};

export type Telemetry = {
  readonly enabled: boolean;
  /** Resolves once the event is delivered or dropped. Never rejects. */
  capture(event: TelemetryEventName, properties?: TelemetryProperties): Promise<void>;
};

const KNOWN_ADAPTER_NAMES = new Set(Object.keys(SUPPORTED_MESSAGE_FIELDS));

/** Maps custom adapter names to "custom" so telemetry never carries user-defined strings. */
export function normalizeAdapterName(name: string | undefined) {
  if (!name) {
    return "unknown";
  }

  return KNOWN_ADAPTER_NAMES.has(name) ? name : "custom";
}

export function createTelemetry(options: TelemetryOptions = {}): Telemetry {
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? fetch;
  const notify = options.notify ?? ((message: string) => process.stderr.write(`${message}\n`));

  if (isTelemetryDisabled(env)) {
    return {
      enabled: false,
      capture: () => Promise.resolve(),
    };
  }

  const configDir =
    options.configDir ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "email-sdk");
  const state = loadTelemetryState(configDir);

  if (!state.noticeShown) {
    notify(TELEMETRY_NOTICE);
    persistTelemetryState(configDir, { ...state, noticeShown: true });
  }

  const commonProperties = {
    sdk_version: options.sdkVersion ?? readSdkVersion(),
    node_version: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    ci: env.CI === "true" || env.CI === "1",
  };

  return {
    enabled: true,
    async capture(event, properties) {
      try {
        const response = await fetcher(`${POSTHOG_HOST}/capture/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: captureTimeoutSignal(),
          body: JSON.stringify({
            api_key: POSTHOG_PROJECT_KEY,
            event,
            distinct_id: state.anonymousId,
            timestamp: new Date().toISOString(),
            properties: {
              ...commonProperties,
              ...properties,
              $process_person_profile: false,
            },
          }),
        });

        await response.body?.cancel();
      } catch {
        // Telemetry must never break sending email.
      }
    },
  };
}

let sharedTelemetry: Telemetry | undefined;

export function getTelemetry(): Telemetry {
  sharedTelemetry ??= createTelemetry();
  return sharedTelemetry;
}

function isTelemetryDisabled(env: Record<string, string | undefined>) {
  const optOut = env.EMAIL_SDK_TELEMETRY?.toLowerCase();

  if (optOut === "0" || optOut === "false" || optOut === "off") {
    return true;
  }

  const doNotTrack = env.DO_NOT_TRACK?.toLowerCase();

  if (doNotTrack === "1" || doNotTrack === "true") {
    return true;
  }

  return env.NODE_ENV === "test";
}

type TelemetryState = {
  anonymousId: string;
  noticeShown: boolean;
};

function loadTelemetryState(configDir: string): TelemetryState {
  try {
    const parsed = JSON.parse(readFileSync(join(configDir, "telemetry.json"), "utf8")) as Partial<
      TelemetryState
    >;

    if (typeof parsed.anonymousId === "string" && parsed.anonymousId) {
      return {
        anonymousId: parsed.anonymousId,
        noticeShown: parsed.noticeShown === true,
      };
    }
  } catch {
    // Missing or unreadable state falls through to a fresh identity.
  }

  const state = { anonymousId: randomUUID(), noticeShown: false };
  persistTelemetryState(configDir, state);

  return state;
}

function persistTelemetryState(configDir: string, state: TelemetryState) {
  try {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "telemetry.json"), `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // Read-only environments still get telemetry with a per-process identity.
  }
}

function captureTimeoutSignal() {
  return typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(CAPTURE_TIMEOUT_MS)
    : undefined;
}

function readSdkVersion() {
  try {
    const packageJson = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { version?: string };

    return packageJson.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
