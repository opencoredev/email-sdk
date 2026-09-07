import { describe, expect, test } from "bun:test";
import { runDoctor, type DoctorOptions } from "./doctor.js";
import { selectLiveAdapters } from "../../../scripts/changed-live-adapters.js";
import { nonSendingEnvironment } from "../../../scripts/run-live-adapters.js";

const credential = "private-api-key-canary";
const domain = {
  id: "private-account-id",
  name: "example.com",
  status: "verified",
  capabilities: { sending: "enabled" },
};
const list = (data: unknown[] = [domain], has_more = false) => ({ data, has_more });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const options: DoctorOptions = { adapter: "resend", credential, live: true };
const run = (body: unknown, extra: Partial<DoctorOptions> = {}) =>
  runDoctor({ ...options, fetch: async () => json(body), ...extra });

describe("shared live gate wiring", () => {
  const all = ["jetemail", "lettermint", "lettr", "primitive", "resend", "sequenzy"];
  test.each([
    "packages/email-sdk/src/doctor.ts",
    "packages/email-sdk/src/doctor.test.ts",
    "packages/email-sdk/src/cli.ts",
    "scripts/changed-live-adapters.ts",
    "scripts/run-live-adapters.ts",
  ])("shared change %s selects all six checks", (file) => {
    expect(selectLiveAdapters([file])).toEqual(all);
  });
  test("individual adapters select only their checks", () => {
    expect(
      selectLiveAdapters(["packages/email-sdk/src/resend.ts", "scripts/check-lettr-account.ts"]),
    ).toEqual(["lettr", "resend"]);
    expect(selectLiveAdapters(["README.md"])).toEqual([]);
  });
  test("runner rejects unknown checks without starting a provider command", async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        new URL("../../../scripts/run-live-adapters.ts", import.meta.url).pathname,
        "unknown-fixture-adapter",
      ],
      { env: { EMAIL_SDK_TELEMETRY: "0" }, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr.trim()).toBe("Unknown live adapter check: unknown-fixture-adapter");
  });

  test("runner strips every live-send variable and neutralizes dotenv send switches", () => {
    const env = {
      RESEND_LIVE_SEND: "true",
      UNREGISTERED_LIVE_SEND: "true",
      LETTERMINT_LIVE_SEND: "true",
      RESEND_API_KEY: "private-key",
    };
    const safe = nonSendingEnvironment(env);
    expect(safe.UNREGISTERED_LIVE_SEND).toBeUndefined();
    for (const name of all) expect(safe[`${name.toUpperCase()}_LIVE_SEND`]).toBe("false");
    expect(safe.RESEND_API_KEY).toBe("private-key");
    expect(env.RESEND_LIVE_SEND).toBe("true");
  });
});

describe("doctor safe probes", () => {
  test("default checks configuration without provider requests", async () => {
    let calls = 0;
    const result = await runDoctor({
      ...options,
      live: false,
      fetch: async () => {
        calls++;
        throw new Error(credential);
      },
    });
    expect(calls).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.checks.authentication.status).toBe("not_requested");
    expect(result.checks.sender.status).toBe("not_requested");
  });

  test.each([undefined, "", "   "])("missing credential %s blocks requests", async (credential) => {
    let calls = 0;
    const result = await runDoctor({
      ...options,
      credential,
      fetch: async () => {
        calls++;
        return json(list());
      },
    });
    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.checks.configuration.status).toBe("failed");
    expect(result.checks.authentication.status).toBe("blocked");
  });

  test("from requires live without a request", async () => {
    const result = await run(list(), {
      live: false,
      from: "hello@example.com",
      fetch: async () => {
        throw new Error("must not request");
      },
    });
    expect(result.checks.configuration.message).toContain("--from requires --live");
    expect(result.ok).toBe(false);
  });

  test.each([
    ["resend", "https://api.resend.com/domains?limit=100", list()],
    [
      "sequenzy",
      "https://api.sequenzy.com/api/v1/account",
      { success: true, companies: [{ id: "private-account-id" }] },
    ],
    [
      "primitive",
      "https://api.primitive.dev/v1/account",
      { success: true, data: { id: "private-account-id" } },
    ],
    ["lettermint", "https://api.lettermint.co/v1/ping", 200],
    [
      "lettr",
      "https://app.lettr.com/api/auth/check",
      { message: "API key is valid.", data: { team_id: 123, timestamp: "2026-01-01T00:00:00Z" } },
    ],
  ])("%s uses its documented non-sending GET", async (adapter, endpoint, body) => {
    let calls = 0;
    const result = await runDoctor({
      ...options,
      adapter: String(adapter),
      fetch: async (url, init) => {
        calls++;
        expect(url).toBe(endpoint);
        expect(init.method).toBe("GET");
        expect(init.body).toBeUndefined();
        expect(init.redirect).toBe("error");
        expect(init.signal).toBeInstanceOf(AbortSignal);
        const headers = new Headers(init.headers);
        expect(headers.get(adapter === "lettermint" ? "x-lettermint-token" : "Authorization")).toBe(
          adapter === "lettermint" ? credential : `Bearer ${credential}`,
        );
        return json(body);
      },
    });
    expect(calls).toBe(1);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(JSON.stringify(result)).not.toContain("private-account-id");
    expect(JSON.stringify(result)).not.toContain("team_id");
  });

  test.each([200, 201, 400, 422])(
    "JetEmail HTTP %s cannot alone prove authentication",
    async (status) => {
      const result = await runDoctor({
        ...options,
        adapter: "jetemail",
        fetch: async (url, init) => {
          expect(url).toBe("https://api.jetemail.com/email");
          expect(init.method).toBe("POST");
          expect(init.body).toBe("{}");
          expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
          expect(init.redirect).toBe("error");
          return json({ message: "Missing from, to, subject", secret: credential }, status);
        },
      });
      expect(result.ok).toBe(false);
      expect(result.checks.authentication.status).toBe("inconclusive");
      expect(JSON.stringify(result)).not.toContain(credential);
    },
  );

  test.each([
    [401, "invalid_credentials"],
    [403, "insufficient_permissions"],
    [400, "inconclusive"],
    [422, "inconclusive"],
    [429, "rate_limited"],
    [500, "inconclusive"],
    [302, "inconclusive"],
  ])("HTTP %s has a distinct safe diagnostic", async (status, expected) => {
    const result = await runDoctor({
      ...options,
      from: "secret@example.com",
      fetch: async () =>
        json({ message: credential, account: "private-account-id" }, Number(status)),
    });
    expect(result.checks.authentication.status).toBe(expected);
    expect(result.checks.sender.status).toBe("blocked");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(credential);
    expect(JSON.stringify(result)).not.toContain("secret@example.com");
    expect(JSON.stringify(result)).not.toContain("private-account-id");
  });

  test.each(["resend", "sequenzy", "primitive", "lettermint", "lettr"])(
    "%s rejects malformed success",
    async (adapter) => {
      for (const body of [null, {}, [], { success: true }, "200"]) {
        const result = await run(body, { adapter });
        expect(result.checks.authentication.status).toBe("inconclusive");
        expect(result.ok).toBe(false);
      }
    },
  );

  test("Resend sending-only HTTP 401 is permissions, not invalid credentials", async () => {
    const result = await runDoctor({
      ...options,
      from: "hello@example.com",
      fetch: async () => json({ name: "restricted_api_key", message: credential }, 401),
    });
    expect(result.checks.authentication.status).toBe("insufficient_permissions");
    expect(result.checks.sender.status).toBe("blocked");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(credential);
  });

  test("raw malformed JSON and network errors stay private", async () => {
    for (const [fetch, status] of [
      [async () => new Response(credential), "inconclusive"],
      [
        async () => {
          throw new Error(credential);
        },
        "network_failure",
      ],
    ] as const) {
      const result = await runDoctor({ ...options, fetch });
      expect(result.checks.authentication.status).toBe(status);
      expect(JSON.stringify(result)).not.toContain(credential);
    }
  });

  test("every failure state is distinct in status and message", async () => {
    const results = {
      invalid_credentials: await run({}, { fetch: async () => json({}, 401) }),
      insufficient_permissions: await run({}, { fetch: async () => json({}, 403) }),
      inconclusive: await run({}, { fetch: async () => json({}, 400) }),
      rate_limited: await run({}, { fetch: async () => json({}, 429) }),
      network_failure: await run({}, {
        fetch: async () => {
          throw new Error(credential);
        },
      }),
      timeout: await run({}, { timeoutMs: 5, fetch: () => new Promise(() => {}) }),
      unsupported: await run({}, { adapter: "smtp" }),
    };
    for (const [status, result] of Object.entries(results)) {
      expect(result.checks.authentication.status).toBe(status);
      expect(result.ok).toBe(false);
    }
    const messages = Object.values(results).map((result) => result.checks.authentication.message);
    expect(new Set(messages).size).toBe(messages.length);
    const unverified = await run(list([{ ...domain, status: "pending" }]), {
      from: "hello@example.com",
    });
    expect(unverified.checks.sender.status).toBe("not_ready");
    expect(unverified.ok).toBe(false);
  });

  test("rate limits, transport failures, and invalid responses have distinct private actions", async () => {
    const rate = await runDoctor({
      ...options,
      fetch: async () => json({ secret: credential }, 429),
    });
    const network = await runDoctor({
      ...options,
      fetch: async () => {
        throw new Error(credential);
      },
    });
    const stream = await runDoctor({
      ...options,
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error(credential));
            },
          }),
        ),
    });
    const malformed = await runDoctor({ ...options, fetch: async () => new Response(credential) });
    const invalid = await run({ unexpected: credential });
    expect(rate.checks.authentication.message).toContain("HTTP 429");
    expect(rate.checks.authentication.message).toContain("Wait before retrying");
    expect(network.checks.authentication.message).toContain("network or redirect transport");
    expect(network.checks.authentication.message).toContain("TLS, proxy settings");
    expect(stream.checks.authentication.message).toBe(network.checks.authentication.message);
    expect(malformed.checks.authentication.message).toContain("invalid or inconclusive response");
    expect(invalid.checks.authentication.message).toBe(malformed.checks.authentication.message);
    expect(
      new Set([rate, network, malformed].map((result) => result.checks.authentication.message))
        .size,
    ).toBe(3);
    expect(rate.checks.authentication.status).toBe("rate_limited");
    expect(network.checks.authentication.status).toBe("network_failure");
    expect(stream.checks.authentication.status).toBe("network_failure");
    expect(malformed.checks.authentication.status).toBe("inconclusive");
    expect(invalid.checks.authentication.status).toBe("inconclusive");
    for (const result of [rate, network, stream, malformed, invalid]) {
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(credential);
    }
  });

  test("redirect rejection is diagnosed as transport without following it", async () => {
    let calls = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { Location: new URL("/blocked", request.url).href },
        });
      },
    });
    try {
      const result = await runDoctor({ ...options, baseUrl: server.url.origin });
      expect(result.ok).toBe(false);
      expect(result.checks.authentication.status).toBe("network_failure");
      expect(result.checks.authentication.message).toContain("network or redirect transport");
      expect(calls).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test.each(["rate", "network", "malformed"])(
    "later %s failure preserves actionable sender diagnostics",
    async (mode) => {
      let calls = 0;
      const result = await runDoctor({
        ...options,
        from: "hello@example.com",
        fetch: async () => {
          if (++calls === 1) return json(list([{ ...domain, name: "other.example.com" }], true));
          if (mode === "network") throw new Error(credential);
          if (mode === "rate") return json({ secret: credential }, 429);
          return new Response(credential);
        },
      });
      expect(result.ok).toBe(false);
      expect(result.checks.authentication.status).toBe("passed");
      expect(result.checks.sender.status).toBe(
        mode === "rate" ? "rate_limited" : mode === "network" ? "network_failure" : "inconclusive",
      );
      expect(result.checks.sender.message).toContain(
        mode === "rate"
          ? "HTTP 429"
          : mode === "network"
            ? "network or redirect transport"
            : "Sender readiness could not be confirmed",
      );
      expect(JSON.stringify(result)).not.toContain(credential);
    },
  );

  test("bounds oversized response bodies", async () => {
    const result = await runDoctor({
      ...options,
      fetch: async () => new Response("x".repeat(1_048_577)),
    });
    expect(result.checks.authentication.status).toBe("inconclusive");
  });

  test("timeout bounds even a fetch that ignores its signal", async () => {
    const result = await runDoctor({
      ...options,
      timeoutMs: 5,
      fetch: () => new Promise(() => {}),
    });
    expect(result.checks.authentication.status).toBe("timeout");
    expect(result.ok).toBe(false);
  });

  test("timeout also bounds reading the body", async () => {
    const result = await runDoctor({
      ...options,
      timeoutMs: 5,
      fetch: async () => new Response(new ReadableStream({ start() {} })),
    });
    expect(result.checks.authentication.status).toBe("timeout");
  });

  test.each([
    "https://evil.example",
    "http://api.resend.com",
    "https://api.resend.com/other",
    "https://api.resend.com.evil.example",
    "https://key@api.resend.com",
    "https://api.resend.com?key=secret",
    "https://api.resend.com#secret",
    "not a URL",
    "http://localhost:1234",
  ])("rejects unsafe base %s before requests", async (baseUrl) => {
    let calls = 0;
    const result = await run(list(), {
      baseUrl,
      fetch: async () => {
        calls++;
        return json(list());
      },
    });
    expect(calls).toBe(0);
    expect(result.checks.configuration.status).toBe("failed");
    expect(JSON.stringify(result)).not.toContain(baseUrl);
  });

  test.each(["http://127.0.0.1:1234", "http://[::1]:1234/v1", "https://api.resend.com/"])(
    "allows explicit fixture or canonical base %s",
    async (baseUrl) => {
      const result = await run(list(), {
        baseUrl,
        fetch: async (url) => {
          expect(url).toBe(`${baseUrl.replace(/\/$/, "")}/domains?limit=100`);
          return json(list());
        },
      });
      expect(result.ok).toBe(true);
    },
  );

  test("unsupported authentication is not a successful live check", async () => {
    let calls = 0;
    const result = await run(list(), {
      adapter: "smtp",
      from: "hello@example.com",
      fetch: async () => {
        calls++;
        return json(list());
      },
    });
    expect(calls).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.checks.authentication.status).toBe("unsupported");
    expect(result.checks.sender.status).toBe("unsupported");
  });

  test("other providers keep authentication separate from unsupported sender readiness", async () => {
    const result = await run(
      { success: true, companies: [] },
      { adapter: "sequenzy", from: "hello@example.com" },
    );
    expect(result.checks.authentication.status).toBe("passed");
    expect(result.checks.sender.status).toBe("unsupported");
    expect(result.ok).toBe(false);
  });
});

describe("Resend sender readiness", () => {
  test.each(["hello@example.com", "Hello <hello@EXAMPLE.COM>"])(
    "verifies exact domain for %s",
    async (from) => {
      const result = await run(list(), { from });
      expect(result.ok).toBe(true);
      expect(result.checks.sender.status).toBe("passed");
      expect(JSON.stringify(result)).not.toContain("example.com");
    },
  );

  test.each([
    "",
    "bad",
    "a@",
    "@example.com",
    "a@example.com,b@example.com",
    "a@example.com\r\nBcc: b@example.com",
    "a@-example.com",
    "a..b@example.com",
    "a@example.com>",
  ])("rejects malformed sender %s independently", async (from) => {
    const result = await run(list(), { from });
    expect(result.ok).toBe(false);
    expect(result.checks.sender.status).toBe("failed");
    expect(result.checks.authentication.status).toBe("passed");
  });

  test.each([
    list([]),
    list([{ ...domain, status: "pending" }]),
    list([{ ...domain, capabilities: { sending: "disabled" } }]),
    list([{ ...domain, name: "sub.example.com" }]),
  ])("does not overstate readiness", async (body) => {
    const result = await run(body, { from: "hello@example.com" });
    expect(result.checks.authentication.status).toBe("passed");
    expect(result.checks.sender.status).toBe("not_ready");
    expect(result.ok).toBe(false);
  });

  test.each([
    list([null]),
    list([{ name: "example.com" }]),
    list([{ ...domain, status: "unknown" }]),
    list([{ ...domain, capabilities: {} }]),
    list([{ ...domain, capabilities: { sending: true } }]),
    list([{ ...domain, capabilities: { sending: ["enabled"] } }]),
  ])("malformed domain readiness remains inconclusive", async (body) => {
    const result = await run(body, { from: "hello@example.com" });
    expect(result.checks.sender.status).toBe("inconclusive");
    expect(result.ok).toBe(false);
  });

  test("paginates with encoded cursor on the fixed origin", async () => {
    const urls: string[] = [];
    const result = await runDoctor({
      ...options,
      from: "hello@example.com",
      fetch: async (url) => {
        urls.push(url);
        return json(
          urls.length === 1
            ? list(
                [{ ...domain, id: "https://evil.example/?key=x", name: "other.example.com" }],
                true,
              )
            : list(),
        );
      },
    });
    expect(result.ok).toBe(true);
    expect(urls).toEqual([
      "https://api.resend.com/domains?limit=100",
      "https://api.resend.com/domains?limit=100&after=https%3A%2F%2Fevil.example%2F%3Fkey%3Dx",
    ]);
  });

  test("bounds pagination to ten pages", async () => {
    let calls = 0;
    const result = await runDoctor({
      ...options,
      from: "hello@example.com",
      fetch: async () =>
        json(list([{ ...domain, id: String(++calls), name: "other.example.com" }], true)),
    });
    expect(calls).toBe(10);
    expect(result.checks.authentication.status).toBe("passed");
    expect(result.checks.sender.status).toBe("inconclusive");
  });

  test.each([
    list([], true),
    list([{ ...domain, id: undefined, name: "other.example.com" }], true),
  ])("missing pagination cursor is inconclusive", async (body) => {
    expect((await run(body, { from: "hello@example.com" })).checks.sender.status).toBe(
      "inconclusive",
    );
  });

  test("repeated pagination cursors stop", async () => {
    let calls = 0;
    const result = await runDoctor({
      ...options,
      from: "hello@example.com",
      fetch: async () => {
        calls++;
        return json(list([{ ...domain, name: "other.example.com" }], true));
      },
    });
    expect(calls).toBe(2);
    expect(result.checks.sender.status).toBe("inconclusive");
  });

  test("later permission failure does not erase authentication success", async () => {
    let calls = 0;
    const result = await runDoctor({
      ...options,
      from: "hello@example.com",
      fetch: async () =>
        ++calls === 1
          ? json(list([{ ...domain, name: "other.example.com" }], true))
          : json({}, 403),
    });
    expect(result.checks.authentication.status).toBe("passed");
    expect(result.checks.sender.status).toBe("insufficient_permissions");
    expect(result.ok).toBe(false);
  });
});
