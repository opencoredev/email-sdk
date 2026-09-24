import {
  type JsonValue,
  isJsonBoolean,
  isJsonObject,
  jsonField,
  jsonString,
  parseJsonStrict,
} from "./internal/decode.js";

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
  tenantId?: string;
  clientId?: string;
  tokenUrl?: string;
  scope?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
};

const probes = {
  graph: { base: "", path: "" },
  resend: { base: "https://api.resend.com", path: "/domains?limit=100" },
  sequenzy: { base: "https://api.sequenzy.com/api/v1", path: "/account" },
  primitive: { base: "https://api.primitive.dev/v1", path: "/account" },
  lettermint: { base: "https://api.lettermint.co/v1", path: "/ping" },
  lettr: { base: "https://app.lettr.com/api", path: "/auth/check" },
  jetemail: { base: "https://api.jetemail.com", path: "/email" },
  // SendHeron has no account endpoint; reading a send that cannot exist needs the
  // emails:send scope and answers 404 emailSending.notFound once the key authenticates.
  sendheron: {
    base: "https://api.sendheron.com/api/v1",
    path: "/emails/00000000-0000-4000-8000-000000000000",
  },
} as const;

class TransportFailure extends Error {}

type ProbeName = keyof typeof probes;

function isProbeName(name: string): name is ProbeName {
  return Object.prototype.hasOwnProperty.call(probes, name);
}

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

  const adapterName = options.adapter;

  if (!isProbeName(adapterName)) {
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

  const adapter = adapterName;
  const probe = probes[adapter];
  const base = adapter === "graph" ? "graph" : safeBase(options.baseUrl, probe.base);

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

  if (adapter === "graph") {
    const tokenUrl = graphTokenUrl(options.tokenUrl, options.tenantId);

    if (!tokenUrl || !options.tenantId?.trim() || !options.clientId?.trim()) {
      checks.configuration = check(
        "failed",
        "Provide valid Graph tenant, client, and token endpoint configuration before requesting a live check.",
      );
      clearTimeout(timer);

      return finish();
    }

    const work = async () => {
      let response: Response;

      try {
        response = await (options.fetch ?? fetch)(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: options.clientId!,
            client_secret: options.credential!,
            scope: options.scope ?? "https://graph.microsoft.com/.default",
            grant_type: "client_credentials",
          }),
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        throw new TransportFailure();
      }

      controller.signal.throwIfAborted();

      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {});
        checks.authentication =
          response.status === 401 || response.status === 400
            ? check("invalid_credentials", "Graph rejected the client credentials. Verify the tenant, client ID, secret, and application permissions.")
            : response.status === 429
              ? check("rate_limited", "Graph rate limited the authentication check (HTTP 429). Retry later; this does not prove the credentials are invalid.")
              : uncertain();

        return;
      }

      const body = await boundedJson(response, controller.signal);
      checks.authentication =
        jsonString(body, "access_token")
          ? authenticated()
          : uncertain();
    };

    try {
      await Promise.race([work(), deadline]);
    } catch (error) {
      checks.authentication = controller.signal.aborted
        ? check("timeout", "The live check timed out. Check connectivity and provider status, then retry.")
        : error instanceof TransportFailure
          ? check("network_failure", "The live check failed at the network or redirect transport layer. Check connectivity, TLS, proxy settings, and the fixed token URL; redirects are not followed.")
          : uncertain();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }

    if (domain) checks.sender = check("unsupported", "Graph sender readiness is not checked by this non-sending probe.");

    return finish();
  }

  const request = async (path: string) => {
    const headers = new Headers({ Accept: "application/json" });

    if (adapter === "lettermint") headers.set("x-lettermint-token", options.credential!);
    else headers.set("Authorization", `Bearer ${options.credential}`);
    const validation = adapter === "jetemail";

    if (validation) headers.set("Content-Type", "application/json");
    let response: Response;

    try {
      const init: RequestInit = {
        method: validation ? "POST" : "GET",
        headers,
        redirect: "error",
        signal: controller.signal,
      };

      if (validation) init.body = "{}";
      response = await (options.fetch ?? fetch)(`${base}${path}`, init);
    } catch {
      throw new TransportFailure();
    }

    controller.signal.throwIfAborted();

    if (
      (response.status !== 200 &&
        !(adapter === "resend" && response.status === 401) &&
        !(adapter === "sendheron" && response.status === 404)) ||
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

    if (adapter === "sendheron" && first.status === 404) {
      checks.authentication = validAuthentication(adapter, first.body)
        ? authenticated()
        : uncertain();

      return;
    }

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
      const domains = jsonField(body, "data");

      if (!Array.isArray(domains) || !domains.every(validDomain)) return;
      const target = domains.find((item) => domainName(item)?.toLowerCase() === domain);

      if (target) {
        const status = jsonString(target, "status");
        const sending = jsonString(jsonField(target, "capabilities"), "sending");

        if (
          status === undefined ||
          !["not_started", "pending", "verified", "failed", "temporary_failure"].includes(status) ||
          sending === undefined ||
          !["enabled", "disabled"].includes(sending)
        )
          return;
        checks.sender =
          status === "verified" && sending === "enabled"
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

      const hasMore = jsonField(body, "has_more");

      if (hasMore === false) {
        checks.sender = check(
          "not_ready",
          "Sender domain was not found. Add and verify the exact sender domain in Resend.",
        );

        return;
      }

      if (hasMore !== true || page === 9) return;
      const cursor = jsonString(domains.at(-1), "id");

      if (cursor === undefined || !cursor || cursor.length > 256 || cursors.has(cursor))
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

function httpFailure(
  status: number,
  adapter: ProbeName,
  body: JsonValue | undefined,
): DoctorCheck | undefined {
  if (status === 200) return undefined;

  if (status === 429)
    return check(
      "rate_limited",
      "The provider rate limited the live check (HTTP 429). Wait before retrying and reduce request frequency; this does not prove the key is invalid.",
    );

  if (
    adapter === "resend" &&
    status === 401 &&
    jsonField(body, "name") === "restricted_api_key"
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

function validAuthentication(adapter: ProbeName, body: JsonValue | undefined): boolean {
  if (adapter === "lettermint") return body === 200;

  if (!isJsonObject(body)) return false;

  if (adapter === "sendheron") return body.message === "emailSending.notFound";

  if (adapter === "resend") return Array.isArray(body.data) && isJsonBoolean(body.has_more);

  if (adapter === "sequenzy") return body.success === true && Array.isArray(body.companies);

  if (adapter === "primitive")
    return body.success === true && jsonString(body.data, "id") !== undefined;

  if (adapter === "lettr")
    return (
      body.message === "API key is valid." &&
      Number.isInteger(jsonField(body.data, "team_id")) &&
      jsonString(body.data, "timestamp") !== undefined
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

function graphTokenUrl(value: string | undefined, tenantId: string | undefined): string | undefined {
  const fallback = tenantId?.trim()
    ? `https://login.microsoftonline.com/${encodeURIComponent(tenantId.trim())}/oauth2/v2.0/token`
    : undefined;

  if (value === undefined) return fallback;

  try {
    const url = new URL(value);

    if (url.username || url.password || url.search || url.hash) return;

    if (["127.0.0.1", "[::1]"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol)) return url.href;

    if (url.protocol !== "https:" || !["login.microsoftonline.com", "login.microsoftonline.us", "login.chinacloudapi.cn", "login.microsoftonline.de"].includes(url.hostname)) return;

    return url.href;
  } catch {
    return;
  }
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

function domainName(value: JsonValue): string | undefined {
  return jsonString(value, "name");
}

function validDomain(value: JsonValue): boolean {
  const name = domainName(value);

  return name !== undefined && Boolean(senderDomain(`probe@${name}`));
}

async function boundedJson(
  response: Response,
  signal: AbortSignal,
): Promise<JsonValue | undefined> {
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

    return parseJsonStrict(text + decoder.decode());
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
