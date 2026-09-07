export type DoctorStatus =
  | "passed"
  | "failed"
  | "not_requested"
  | "blocked"
  | "unsupported"
  | "invalid_credentials"
  | "insufficient_permissions"
  | "inconclusive"
  | "rate_limited"
  | "network_failure"
  | "timeout"
  | "not_ready";

export type DoctorCheck = { status: DoctorStatus; message: string };
export type DoctorResult = {
  ok: boolean;
  adapter: string;
  checks: { configuration: DoctorCheck; authentication: DoctorCheck; sender: DoctorCheck };
};
export type DoctorOptions = {
  adapter: string;
  credential?: string;
  configured?: boolean;
  live?: boolean;
  from?: string;
  baseUrl?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

const probes = {
  resend: { base: "https://api.resend.com", path: "/domains?limit=100" },
  sequenzy: { base: "https://api.sequenzy.com/api/v1", path: "/account" },
  primitive: { base: "https://api.primitive.dev/v1", path: "/account" },
  lettermint: { base: "https://api.lettermint.co/v1", path: "/ping" },
  lettr: { base: "https://app.lettr.com/api", path: "/auth/check" },
  jetemail: { base: "https://api.jetemail.com", path: "/email" },
} as const;

class TransportFailure extends Error {}

type ProbeName = keyof typeof probes;
const check = (status: DoctorStatus, message: string): DoctorCheck => ({ status, message });
const skipped = () => check("not_requested", "Not requested.");
const uncertain = () =>
  check(
    "inconclusive",
    "The provider returned an invalid or inconclusive response. Check provider status and verify the key in the provider dashboard.",
  );
const senderUncertain = () =>
  check(
    "inconclusive",
    "Sender readiness could not be confirmed. Inspect domain verification and sending capability in the Resend dashboard.",
  );
const blocked = () =>
  check("blocked", "Fix configuration and authentication before checking sender readiness.");
const authenticated = () =>
  check(
    "passed",
    "Credentials authenticated. This does not confirm sending permission or delivery.",
  );

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const configured = options.configured ?? Boolean(options.credential?.trim());
  const checks: DoctorResult["checks"] = {
    configuration: configured
      ? check(
          "passed",
          "Required configuration is present; credentials have not been validated by this check.",
        )
      : check(
          "failed",
          "Provide the required adapter credentials through flags or environment variables.",
        ),
    authentication: options.live
      ? check("blocked", "Fix the required configuration before requesting authentication.")
      : skipped(),
    sender: options.from !== undefined ? blocked() : skipped(),
  };
  const finish = (): DoctorResult => ({
    ok: Object.values(checks).every(
      (item) => item.status === "passed" || item.status === "not_requested",
    ),
    adapter: options.adapter,
    checks,
  });
  if (options.from !== undefined && !options.live) {
    checks.configuration = check(
      "failed",
      "--from requires --live. Omit --from for configuration-only checks.",
    );
    return finish();
  }
  const domain = options.from !== undefined ? senderDomain(options.from) : undefined;
  if (options.from !== undefined && !domain) {
    checks.sender = check(
      "failed",
      "Provide one valid sender mailbox with --from, optionally with a display name.",
    );
  }
  if (!options.live || !configured) return finish();
  if (!Object.prototype.hasOwnProperty.call(probes, options.adapter)) {
    checks.authentication = check(
      "unsupported",
      "No safe live authentication probe is available for this adapter. Verify credentials in its dashboard.",
    );
    if (domain)
      checks.sender = check(
        "unsupported",
        "Sender readiness is supported only for Resend. Verify the sender in the provider dashboard.",
      );
    return finish();
  }
  const adapter = options.adapter as ProbeName;
  const probe = probes[adapter];
  const base = safeBase(options.baseUrl, probe.base);
  if (!base) {
    checks.configuration = check(
      "failed",
      "Use the fixed HTTPS provider base URL or an explicit numeric-loopback fixture URL. Redirects are not followed.",
    );
    return finish();
  }
  if (!options.credential?.trim()) {
    checks.configuration = check(
      "failed",
      "Provide the adapter API credential before requesting a live check.",
    );
    return finish();
  }
  if (domain && adapter !== "resend") {
    checks.sender = check(
      "unsupported",
      "Sender readiness is supported only for Resend. Verify the sender in the provider dashboard.",
    );
  }
  const controller = new AbortController();
  const timeout = Math.max(1, Math.min(options.timeoutMs ?? 10_000, 30_000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, timeout);
  });
  const request = async (path: string) => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (adapter === "lettermint") headers["x-lettermint-token"] = options.credential!;
    else headers.Authorization = `Bearer ${options.credential}`;
    const validation = adapter === "jetemail";
    if (validation) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(`${base}${path}`, {
        method: validation ? "POST" : "GET",
        headers,
        ...(validation ? { body: "{}" } : {}),
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new TransportFailure();
    }
    controller.signal.throwIfAborted();
    if (
      (response.status !== 200 && !(adapter === "resend" && response.status === 401)) ||
      validation
    ) {
      void response.body?.cancel().catch(() => {});
      return { status: response.status, body: undefined };
    }
    const body = await boundedJson(response, controller.signal);
    controller.signal.throwIfAborted();
    return { status: response.status, body };
  };
  const work = async () => {
    const first = await request(probe.path);
    checks.authentication = httpFailure(first.status, adapter, first.body) ?? uncertain();
    if (first.status !== 200 || adapter === "jetemail") return;
    if (!validAuthentication(adapter, first.body)) return;
    checks.authentication = authenticated();
    if (adapter !== "resend" || !domain) return;
    checks.sender = senderUncertain();
    let body = first.body;
    const cursors = new Set<string>();
    // Bound pagination and use only encoded cursors, never provider-supplied URLs.
    for (let page = 0; page < 10; page++) {
      if (!isRecord(body) || !Array.isArray(body.data) || !body.data.every(validDomain)) return;
      const target = body.data.find((item) => item.name.toLowerCase() === domain);
      if (target) {
        if (
          typeof target.status !== "string" ||
          !["not_started", "pending", "verified", "failed", "temporary_failure"].includes(
            target.status,
          ) ||
          !isRecord(target.capabilities) ||
          typeof target.capabilities.sending !== "string" ||
          !["enabled", "disabled"].includes(target.capabilities.sending)
        )
          return;
        checks.sender =
          target.status === "verified" && target.capabilities.sending === "enabled"
            ? check(
                "passed",
                "Sender domain is verified with sending enabled. This does not guarantee delivery or key-level sending permission.",
              )
            : check(
                "not_ready",
                "Verify the sender domain DNS and enable its sending capability in the Resend dashboard.",
              );
        return;
      }
      if (body.has_more === false) {
        checks.sender = check(
          "not_ready",
          "Sender domain was not found. Add and verify the exact sender domain in Resend.",
        );
        return;
      }
      if (body.has_more !== true || page === 9) return;
      const cursor: unknown = body.data.at(-1)?.id;
      if (typeof cursor !== "string" || !cursor || cursor.length > 256 || cursors.has(cursor))
        return;
      cursors.add(cursor);
      const next = await request(`/domains?limit=100&after=${encodeURIComponent(cursor)}`);
      const failure = httpFailure(next.status, adapter, next.body);
      if (failure) {
        checks.sender = failure.status === "inconclusive" ? senderUncertain() : failure;
        return;
      }
      body = next.body;
    }
  };
  try {
    await Promise.race([work(), deadline]);
  } catch (error) {
    const failure = controller.signal.aborted
      ? check(
          "timeout",
          "The live check timed out. Check connectivity and provider status, then retry.",
        )
      : error instanceof TransportFailure
        ? check(
            "network_failure",
            "The live check failed at the network or redirect transport layer. Check connectivity, TLS, proxy settings, and the fixed provider URL; redirects are not followed.",
          )
        : uncertain();
    if (checks.authentication.status === "passed") {
      if (domain && adapter === "resend")
        checks.sender = failure.status === "inconclusive" ? senderUncertain() : failure;
    } else checks.authentication = failure;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return finish();
}

function httpFailure(status: number, adapter: ProbeName, body: unknown): DoctorCheck | undefined {
  if (status === 200) return undefined;
  if (status === 429)
    return check(
      "rate_limited",
      "The provider rate limited the live check (HTTP 429). Wait before retrying and reduce request frequency; this does not prove the key is invalid.",
    );
  if (
    adapter === "resend" &&
    status === 401 &&
    isRecord(body) &&
    body.name === "restricted_api_key"
  ) {
    return check(
      "insufficient_permissions",
      "This Resend key is restricted to sending. Use a Full access key for domain inspection or verify sender readiness in the dashboard.",
    );
  }
  if (status === 401)
    return check(
      "invalid_credentials",
      "The provider rejected the credentials. Check the loaded key or rotate it in the provider dashboard.",
    );
  if (status === 403)
    return check(
      "insufficient_permissions",
      "The provider denied this probe. Check key scopes, account restrictions, and IP allowlists; this does not prove the key is invalid.",
    );
  return uncertain();
}

function validAuthentication(adapter: ProbeName, body: unknown): boolean {
  if (adapter === "lettermint") return body === 200;
  if (!isRecord(body)) return false;
  if (adapter === "resend") return Array.isArray(body.data) && typeof body.has_more === "boolean";
  if (adapter === "sequenzy") return body.success === true && Array.isArray(body.companies);
  if (adapter === "primitive")
    return body.success === true && isRecord(body.data) && typeof body.data.id === "string";
  if (adapter === "lettr")
    return (
      body.message === "API key is valid." &&
      isRecord(body.data) &&
      Number.isInteger(body.data.team_id) &&
      typeof body.data.timestamp === "string"
    );
  return false;
}

function safeBase(value: string | undefined, expected: string): string | undefined {
  if (value === undefined) return expected;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return;
    const normalized = url.href.replace(/\/$/, "");
    if (normalized === expected) return expected;
    if (["127.0.0.1", "[::1]"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol))
      return normalized;
  } catch {
    /* Invalid URLs are configuration failures. */
  }
  return undefined;
}

function senderDomain(value: string): string | undefined {
  if (/[\r\n]/.test(value)) return;
  const mailbox = value.trim().match(/^(?:[^<>]+\s*<([^<>]+)>|([^<>]+))$/);
  const address = mailbox?.[1] ?? mailbox?.[2];
  if (!address || address.length > 254) return;
  const match = address.match(
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+)$/,
  );
  const local = address.split("@")[0]!;
  if (
    !match ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    local.length > 64 ||
    match[1]!.split(".").some((label) => label.length > 63)
  )
    return;
  return match[1]!.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDomain(value: unknown): value is Record<string, unknown> & { name: string } {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    Boolean(senderDomain(`probe@${value.name}`))
  );
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    while (true) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch {
        throw new TransportFailure();
      }
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_048_576) throw new Error("response limit");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
