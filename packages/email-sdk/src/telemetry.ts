import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { EmailProviderNotFoundError, EmailSdkError, EmailValidationError } from "./errors.js";
import { SUPPORTED_MESSAGE_FIELDS } from "./utils.js";

const POSTHOG_HOST = "https://us.i.posthog.com";
// Public write-only project key. It can only ingest events, never read data.
const POSTHOG_PROJECT_KEY = "phc_D62r4m5ivBr6LPCBqjKHg8GL6QTxT57LTzKrmkg5hNZS";
const CAPTURE_TIMEOUT_MS = 3_000;

const MAX_EXCEPTIONS_PER_PROCESS = 5;
const MAX_CAUSE_CHAIN = 3;
const MAX_STACK_FRAMES = 20;
const MAX_MESSAGE_LENGTH = 300;

export const TELEMETRY_NOTICE = `@opencoredev/email-sdk collects anonymous usage analytics: adapter names, command names, success/failure counts, and redacted error reports. Email content, addresses, and credentials are never collected. Opt out with EMAIL_SDK_TELEMETRY=0 or DO_NOT_TRACK=1. Details: https://github.com/opencoredev/email-sdk#telemetry`;

export type TelemetryEventName =
  | "client created"
  | "email sent"
  | "email batch sent"
  | "cli command run";

export type TelemetrySource = "sdk" | "cli";

export type TelemetryProperties = Record<
  string,
  string | number | boolean | readonly string[] | undefined
>;

export type CaptureExceptionContext = {
  source: TelemetrySource;
  handled: boolean;
  /** Pre-normalized via normalizeAdapterName. */
  adapter?: string;
  command?: string;
};

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
  /** Reports a redacted error to PostHog error tracking. Never rejects. */
  captureException(error: unknown, context: CaptureExceptionContext): Promise<void>;
  /** Resolves once every in-flight capture has settled. Never rejects. */
  flush(): Promise<void>;
};

const KNOWN_ADAPTER_NAMES = new Set(Object.keys(SUPPORTED_MESSAGE_FIELDS));

/** Maps custom adapter names to "custom" so telemetry never carries user-defined strings. */
export function normalizeAdapterName(name: string | undefined) {
  if (!name) {
    return "unknown";
  }

  return KNOWN_ADAPTER_NAMES.has(name) ? name : "custom";
}

/**
 * Usage mistakes (invalid message input, unregistered adapter names) are expected
 * caller errors, not SDK defects, so they stay out of error reports.
 */
export function isReportableSendError(error: unknown) {
  return !(error instanceof EmailValidationError) && !(error instanceof EmailProviderNotFoundError);
}

export function detectCiVendor(env: Record<string, string | undefined>) {
  if (env.GITHUB_ACTIONS) return "github_actions";
  if (env.GITLAB_CI) return "gitlab";
  if (env.CIRCLECI) return "circleci";
  if (env.JENKINS_URL) return "jenkins";
  if (env.TRAVIS) return "travis";
  if (env.BUILDKITE) return "buildkite";
  if (env.VERCEL) return "vercel";
  if (env.CI === "true" || env.CI === "1") return "generic";
  return undefined;
}

export function createTelemetry(options: TelemetryOptions = {}): Telemetry {
  const env = options.env ?? process.env;
  const fetcher = options.fetch ?? fetch;
  const notify = options.notify ?? ((message: string) => process.stderr.write(`${message}\n`));

  if (isTelemetryDisabled(env)) {
    return {
      enabled: false,
      capture: () => Promise.resolve(),
      captureException: () => Promise.resolve(),
      flush: () => Promise.resolve(),
    };
  }

  const configDir =
    options.configDir ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "email-sdk");
  const state = loadTelemetryState(configDir);

  if (!state.noticeShown) {
    notify(TELEMETRY_NOTICE);
    persistTelemetryState(configDir, { ...state, noticeShown: true });
  }

  const ciVendor = detectCiVendor(env);
  const commonProperties = {
    sdk_version: options.sdkVersion ?? readSdkVersion(),
    node_version: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    // Derived from ci_vendor so CI systems that don't set CI=true (Jenkins) still count.
    ci: ciVendor !== undefined,
    ci_vendor: ciVendor,
  };

  const pending = new Set<Promise<void>>();

  // Error reports are deduped per process: once per error object (the same error can
  // surface in both core and CLI catch blocks), once per error class, capped overall.
  const seenErrorObjects = new WeakSet<object>();
  const seenErrorClasses = new Set<string>();
  let exceptionBudget = MAX_EXCEPTIONS_PER_PROCESS;

  async function deliver(event: string, properties?: Record<string, unknown>) {
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
  }

  function enqueue(delivery: Promise<void>) {
    pending.add(delivery);
    void delivery.finally(() => pending.delete(delivery));

    return delivery;
  }

  return {
    enabled: true,
    capture(event, properties) {
      return enqueue(deliver(event, properties));
    },
    captureException(error, context) {
      // Hostile error shapes (throwing getters, non-standard fields) must never
      // turn error reporting into an error source itself.
      try {
        const isErrorObject = typeof error === "object" && error !== null;

        if (isErrorObject && seenErrorObjects.has(error)) {
          return Promise.resolve();
        }

        const exceptionList = buildExceptionList(error, context.handled);
        const head = exceptionList[0];

        if (!head) {
          return Promise.resolve();
        }

        const errorCode = error instanceof EmailSdkError ? error.code : "unknown";
        const classKey = `${head.type}:${error instanceof EmailSdkError ? error.code : head.value.slice(0, 60)}`;

        if (seenErrorClasses.has(classKey) || exceptionBudget <= 0) {
          return Promise.resolve();
        }

        // Mark the object seen only once it is actually reported, so a budget or
        // class-duplicate bail-out never silently consumes a distinct error.
        if (isErrorObject) {
          seenErrorObjects.add(error);
        }

        seenErrorClasses.add(classKey);
        exceptionBudget -= 1;

        const properties: Record<string, unknown> = {
          $exception_list: exceptionList,
          $exception_level: "error",
          error_name: head.type,
          error_code: errorCode,
          source: context.source,
          handled: context.handled,
          adapter: context.adapter,
          command: context.command,
        };

        if (error instanceof EmailSdkError) {
          // Redacted messages vary; the stable name:code pair keeps issue grouping useful.
          properties.$exception_fingerprint = `${head.type}:${error.code}`;
        }

        return enqueue(deliver("$exception", properties));
      } catch {
        return Promise.resolve();
      }
    },
    async flush() {
      // Captures never reject, so waiting on the in-flight set is safe.
      await Promise.all(pending);
    },
  };
}

let sharedTelemetry: Telemetry | undefined;

export function getTelemetry(): Telemetry {
  sharedTelemetry ??= createTelemetry();
  return sharedTelemetry;
}

/**
 * Drops the cached shared instance so the next getTelemetry() call re-reads the
 * environment. Lets long-running processes and tests pick up env changes made
 * after the singleton was first created.
 */
export function resetTelemetry() {
  sharedTelemetry = undefined;
}

/** @internal Test seam: swaps the shared singleton. Pair with resetTelemetry() to restore. */
export function setSharedTelemetry(telemetry: Telemetry | undefined) {
  sharedTelemetry = telemetry;
}

function isTelemetryDisabled(env: Record<string, string | undefined>) {
  const optOut = env.EMAIL_SDK_TELEMETRY?.toLowerCase();

  if (optOut === "0" || optOut === "false" || optOut === "off") {
    return true;
  }

  // Honour the standard DNT value "1" as well as the common "true" alias.
  // Any other value (including "0") is treated as not opting out.
  const doNotTrack = env.DO_NOT_TRACK?.toLowerCase();

  if (doNotTrack === "1" || doNotTrack === "true") {
    return true;
  }

  return env.NODE_ENV === "test";
}

type ExceptionFrame = {
  platform: "node:javascript";
  function: string;
  filename: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
};

type ExceptionListItem = {
  type: string;
  value: string;
  mechanism: { handled: boolean; type: "generic"; synthetic: boolean };
  stacktrace?: { type: "raw"; frames: ExceptionFrame[] };
};

function buildExceptionList(error: unknown, handled: boolean): ExceptionListItem[] {
  const items: ExceptionListItem[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (
    current !== undefined &&
    current !== null &&
    items.length < MAX_CAUSE_CHAIN &&
    !visited.has(current)
  ) {
    visited.add(current);

    const currentError = current instanceof Error ? current : undefined;
    const item: ExceptionListItem = {
      type: currentError ? currentError.name || "Error" : "Error",
      value: redactErrorMessage(currentError ? currentError.message : String(current)),
      mechanism: { handled, type: "generic", synthetic: !currentError },
    };

    const frames = currentError ? parseStackFrames(currentError.stack) : [];

    if (frames.length > 0) {
      item.stacktrace = { type: "raw", frames };
    }

    items.push(item);
    current = currentError?.cause;
  }

  return items;
}

const STACK_LINE_PATTERN = /^\s*at (?:(.*?) \()?((?:file:\/\/)?[^()]+?):(\d+):(\d+)\)?\s*$/;

function parseStackFrames(stack: unknown): ExceptionFrame[] {
  // Error.prototype.stack is non-standard; subclasses can put anything here.
  if (typeof stack !== "string") {
    return [];
  }

  const frames: ExceptionFrame[] = [];

  for (const line of stack.split("\n")) {
    const match = STACK_LINE_PATTERN.exec(line);

    if (!match) {
      continue;
    }

    const filename = sanitizeFrameFilename(match[2] ?? "");

    frames.push({
      platform: "node:javascript",
      function: match[1]?.trim() || "<anonymous>",
      filename,
      lineno: Number(match[3]),
      colno: Number(match[4]),
      in_app: filename.includes("@opencoredev/email-sdk") || filename.includes("email-sdk/dist"),
    });

    if (frames.length >= MAX_STACK_FRAMES) {
      break;
    }
  }

  // PostHog renders Sentry-style stacktraces: outermost call first, throw site last.
  return frames.reverse();
}

/**
 * Reduces stack frame paths to package-relative names (or bare basenames) so
 * reports never carry usernames, home directories, or project layouts.
 */
function sanitizeFrameFilename(raw: string): string {
  let filename = raw.startsWith("file://") ? raw.slice("file://".length) : raw;
  filename = filename.replaceAll("\\", "/");

  const nodeModulesIndex = filename.lastIndexOf("node_modules/");

  if (nodeModulesIndex >= 0) {
    return filename.slice(nodeModulesIndex);
  }

  // Node built-in frames (node:internal/...) carry no user data; keep them whole.
  if (filename.startsWith("node:")) {
    return filename;
  }

  // Everything else — absolute or project-relative source — collapses to its
  // basename so reports never carry usernames, home dirs, or project layouts.
  return filename.split("/").at(-1) || filename;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Any scheme://… so SMTP/AMQP/DB connection strings with embedded credentials are
// scrubbed too, not just http(s).
const URL_PATTERN = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
// Lookarounds (not \b) anchor the full token alphabet: \b sits between word and
// non-word chars, so it would skip trailing base64 padding like "==" and leak it.
const TOKEN_PATTERN = /(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_=-]{24,}(?![A-Za-z0-9+/_=-])/g;
const HOME_DIR_PATTERN = /\/(?:Users|home)\/[^\s/]+/g;

/**
 * Strips the values most likely to carry personal or secret data from error
 * messages: addresses, URLs, quoted user input, long tokens, and home paths.
 */
function redactErrorMessage(message: string): string {
  // Home paths go first: a long alphanumeric username must collapse into "~"
  // rather than being consumed by TOKEN_PATTERN and leaving "/home/<token>".
  let redacted = message;
  const home = homedir();

  if (home && home !== "/") {
    redacted = redacted.split(home).join("~");
  }

  redacted = redacted
    .replace(HOME_DIR_PATTERN, "~")
    // URLs before emails so a "scheme://user:pass@host" is redacted whole rather
    // than the email pass catching only the "pass@host" portion.
    .replace(URL_PATTERN, "<url>")
    .replace(EMAIL_PATTERN, "<email>")
    .replace(/"[^"]*"/g, '"<redacted>"')
    .replace(/'[^']*'/g, "'<redacted>'")
    .replace(/`[^`]*`/g, "`<redacted>`")
    .replace(TOKEN_PATTERN, "<token>");

  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH)}…`
    : redacted;
}

type TelemetryState = {
  anonymousId: string;
  noticeShown: boolean;
};

function loadTelemetryState(configDir: string): TelemetryState {
  try {
    const parsed = JSON.parse(
      readFileSync(join(configDir, "telemetry.json"), "utf8"),
    ) as Partial<TelemetryState>;

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
