import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// SAFETY: this package's own package.json always declares a string name and version.
const packageInfo = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
  name: string;
  version: string;
};

describe("email-sdk CLI", () => {
  test("prints the package version as JSON", async () => {
    const { stdout, stderr, exitCode } = await runCli(["version", "--json"]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      name: packageInfo.name,
      version: packageInfo.version,
    });
  });

  test.each(["version", "--version", "-v"])(
    "prints the package version with %s",
    async (command) => {
      const { stdout, stderr, exitCode } = await runCli([command]);

      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(`${packageInfo.name} ${packageInfo.version}`);
    },
  );

  test("rejects an unsupported adapter during dry run", async () => {
    const { stderr, exitCode } = await runCli([
      "send",
      "--adapter",
      "nope",
      "--from",
      "hello@example.com",
      "--to",
      "user@example.com",
      "--subject",
      "Hello",
      "--text",
      "It works",
      "--dry-run",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unsupported adapter "nope"');
  });

  test("rejects adapter-unsupported fields during dry run", async () => {
    const { stderr, exitCode } = await runCli([
      "send",
      "--adapter",
      "resend",
      "--from",
      "hello@example.com",
      "--to",
      "user@example.com",
      "--subject",
      "Hello",
      "--text",
      "It works",
      "--metadata",
      "order=123",
      "--dry-run",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("resend does not support these EmailMessage fields: metadata");
  });

  test("doctor accepts provider credentials from flags", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "doctor",
      "--adapter",
      "resend",
      "--api-key",
      "re_test",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("resend looks configured.");
  });

  test("doctor JSON defaults to configuration-only without provider traffic", async () => {
    let calls = 0;

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        calls++;

        return Response.json({});
      },
    });

    try {
      const result = await runCli([
        "doctor",
        "--adapter",
        "resend",
        "--api-key",
        "private-key",
        "--base-url",
        server.url.origin,
        "--json",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(calls).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        ok: true,
        adapter: "resend",
        checks: {
          configuration: { status: "passed", message: expect.any(String) },
          authentication: { status: "not_requested", message: expect.any(String) },
          sender: { status: "not_requested", message: expect.any(String) },
        },
      });
      expect(result.stdout).not.toContain("private-key");
    } finally {
      server.stop(true);
    }
  });

  test.each([
    { override: ["--base-url"] },
    { override: ["--base-url", ""] },
    { override: ["--base-url="] },
  ])(
    "doctor rejects a valueless base URL override without falling back",
    async ({ override }) => {
      let calls = 0;

      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch() {
          calls++;

          return Response.json({ data: [], has_more: false });
        },
      });

      try {
        const result = await runCli(
          [
            "doctor",
            "--adapter",
            "resend",
            "--api-key",
            "fixture-key",
            "--live",
            "--json",
            ...override,
          ],
          { RESEND_BASE_URL: server.url.origin },
        );

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout).checks.configuration.status).toBe("failed");
        expect(calls).toBe(0);
      } finally {
        server.stop(true);
      }
    },
  );

  test("doctor live JSON uses flag credentials over environment and verifies Resend sender", async () => {
    let calls = 0;

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        calls++;
        expect(request.method).toBe("GET");
        expect(await request.text()).toBe("");
        expect(request.headers.get("Authorization")).toBe("Bearer flag-private-key");

        return Response.json({
          has_more: false,
          data: [
            {
              id: "private-id",
              name: "example.com",
              status: "verified",
              capabilities: { sending: "enabled" },
            },
          ],
        });
      },
    });

    try {
      const result = await runCli(
        [
          "doctor",
          "--adapter",
          "resend",
          "--api-key",
          "flag-private-key",
          "--base-url",
          server.url.origin,
          "--live",
          "--from",
          "Sender <hello@example.com>",
          "--json",
        ],
        { RESEND_API_KEY: "env-private-key", RESEND_BASE_URL: "https://must-not-request.example" },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(calls).toBe(1);
      const body = JSON.parse(result.stdout);
      expect(body.ok).toBe(true);
      expect(body.checks.sender.status).toBe("passed");

      for (const privateValue of [
        "flag-private-key",
        "env-private-key",
        "private-id",
        "hello@example.com",
      ])
        expect(result.stdout).not.toContain(privateValue);
    } finally {
      server.stop(true);
    }
  });

  test("Graph doctor reports missing configuration as JSON", async () => {
    const result = await runCli(["doctor", "--adapter", "graph", "--live", "--json"], {
      MS_GRAPH_TENANT_ID: "",
      MS_GRAPH_CLIENT_ID: "",
      MS_GRAPH_CLIENT_SECRET: "",
      MS_GRAPH_USER: "",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    const body = JSON.parse(result.stdout);
    expect(body.ok).toBe(false);
    expect(body.checks.configuration.status).toBe("failed");
    expect(body.checks.authentication.status).toBe("blocked");
  });

  test("Graph doctor uses secret flags and national-cloud OAuth options without leaking them", async () => {
    const requests: string[] = [];

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests.push(await request.text());

        return Response.json({ access_token: "private-access-token" });
      },
    });

    try {
      const result = await runCli([
        "doctor", "--adapter", "graph", "--live", "--json",
        "--tenant-id", "tenant", "--client-id", "client", "--user", "mailbox@example.com",
        "--client-secret", "flag-private-secret", "--token-url", server.url.href,
        "--scope", "https://graph.microsoft.us/.default",
      ], { MS_GRAPH_CLIENT_SECRET: "env-private-secret" });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(requests).toHaveLength(1);
      const form = new URLSearchParams(requests[0]);
      expect(form.get("client_secret")).toBe("flag-private-secret");
      expect(form.get("scope")).toBe("https://graph.microsoft.us/.default");
      expect(JSON.parse(result.stdout).checks.authentication.status).toBe("passed");

      for (const secret of ["flag-private-secret", "env-private-secret", "private-access-token"]) {
        expect(result.stdout).not.toContain(secret);
      }
    } finally {
      server.stop(true);
    }
  });

  test.each([
    [401, "invalid_credentials"],
    [403, "insufficient_permissions"],
    [429, "rate_limited"],
    [400, "inconclusive"],
    [422, "inconclusive"],
  ])("doctor JSON HTTP %s exits nonzero privately", async (status, expected) => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.json(
          { message: "private-key private-account-id" },
          { status: Number(status) },
        );
      },
    });

    try {
      const result = await runCli([
        "doctor",
        "--adapter",
        "resend",
        "--api-key",
        "private-key",
        "--base-url",
        server.url.origin,
        "--live",
        "--json",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).checks.authentication.status).toBe(expected);
      expect(result.stdout).not.toContain("private-key");
      expect(result.stdout).not.toContain("private-account-id");
    } finally {
      server.stop(true);
    }
  });

  test("doctor human output for an unverified sender exits nonzero and prints no private data", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.json({
          has_more: false,
          data: [
            {
              id: "private-domain-id",
              name: "example.com",
              status: "pending",
              capabilities: { sending: "disabled" },
              fixture_marker: "FIXTURE-BODY-TEXT",
            },
          ],
        });
      },
    });

    try {
      const result = await runCli([
        "doctor",
        "--adapter",
        "resend",
        "--api-key",
        "re_private_key_000",
        "--base-url",
        server.url.origin,
        "--live",
        "--from",
        "sender@example.com",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("configuration: passed");
      expect(result.stdout).toContain("authentication: passed");
      expect(result.stdout).toContain("sender: not_ready");

      for (const privateValue of [
        "re_private_key_000",
        "private_key",
        "private-domain-id",
        "FIXTURE-BODY-TEXT",
        "sender@example.com",
        "example.com",
        "has_more",
      ])
        expect(result.stdout + result.stderr).not.toContain(privateValue);
    } finally {
      server.stop(true);
    }
  });

  test("doctor never follows a redirect to another local server", async () => {
    let leaked = 0;

    const destination = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        leaked++;

        return Response.json({});
      },
    });

    const redirect = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.redirect(destination.url);
      },
    });

    try {
      const result = await runCli([
        "doctor",
        "--adapter",
        "resend",
        "--api-key",
        "private-key",
        "--base-url",
        redirect.url.origin,
        "--live",
        "--json",
      ]);

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout).checks.authentication.status).toBe("network_failure");
      expect(leaked).toBe(0);
      expect(result.stdout + result.stderr).not.toContain("private-key");
    } finally {
      redirect.stop(true);
      destination.stop(true);
    }
  });

  test("doctor from without live is a structured usage failure", async () => {
    const result = await runCli([
      "doctor",
      "--adapter",
      "resend",
      "--api-key",
      "private-key",
      "--from",
      "hello@example.com",
      "--json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).checks.configuration.message).toContain(
      "--from requires --live",
    );
  });

  test("doctor missing credentials JSON is parseable and does not make requests", async () => {
    const result = await runCli(
      ["doctor", "--adapter", "resend", "--api-key", "", "--live", "--json"],
      { RESEND_API_KEY: "env-private-key" },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).checks.configuration.status).toBe("failed");
    expect(JSON.parse(result.stdout).checks.authentication.status).toBe("blocked");
  });

  test("doctor unknown adapter JSON is private and structured", async () => {
    const result = await runCli([
      "doctor",
      "--adapter",
      "private-key-as-adapter",
      "--live",
      "--json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).adapter).toBe("unknown");
    expect(JSON.parse(result.stdout).checks.configuration.status).toBe("failed");
    expect(result.stdout).not.toContain("private-key-as-adapter");
  });

  test("doctor live unsupported adapter is not a pass", async () => {
    const result = await runCli([
      "doctor",
      "--adapter",
      "smtp",
      "--host",
      "localhost",
      "--live",
      "--json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).checks.authentication.status).toBe("unsupported");
  });

  test("doctor accepts Cloudflare credentials from flags", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "doctor",
      "--adapter",
      "cloudflare",
      "--api-token",
      "cf_test",
      "--account-id",
      "account_123",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("cloudflare looks configured.");
  });

  test("doctor accepts Unosend credentials from flags", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "doctor",
      "--adapter",
      "unosend",
      "--api-key",
      "un_test",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("unosend looks configured.");
  });

  test("doctor accepts SendHeron credentials from flags", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "doctor",
      "--adapter",
      "sendheron",
      "--api-key",
      "sh_test",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("sendheron looks configured.");
  });

  test("doctor accepts Helo credentials from flags", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "doctor",
      "--adapter",
      "helo",
      "--api-key",
      "helo_test",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("helo looks configured.");
  });

  test("doctor accepts Iterable credentials from flags", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "doctor",
      "--adapter",
      "iterable",
      "--api-key",
      "it_test",
      "--campaign-id",
      "123",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("iterable looks configured.");
  });

  test.each([
    { name: "--channel-id", flags: ["--channel-id", "chan_flag"], env: {}, channel: "chan_flag" },
    { name: "HELO_CHANNEL_ID", flags: [], env: { HELO_CHANNEL_ID: "chan_env" }, channel: "chan_env" },
    { name: "no channel", flags: [], env: { HELO_CHANNEL_ID: undefined }, channel: null },
  ])("send passes the Helo channel from $name", async ({ flags, env, channel }) => {
    const channels: Array<string | null> = [];

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        channels.push(request.headers.get("x-helo-channel-id"));

        return Response.json({ status: "accepted", messageId: "helo_1" });
      },
    });

    try {
      const { stderr, exitCode } = await runCli(
        [
          "send",
          "--adapter",
          "helo",
          "--api-key",
          "helo_key",
          "--base-url",
          server.url.origin,
          ...flags,
          "--from",
          "hello@example.com",
          "--to",
          "ada@example.com",
          "--subject",
          "Hello",
          "--text",
          "It works",
        ],
        env,
      );

      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(channels).toEqual([channel]);
    } finally {
      server.stop(true);
    }
  });

  test("dry run rejects Iterable messages over the recipient limit", async () => {
    const { stderr, exitCode } = await runCli([
      "send",
      "--adapter",
      "iterable",
      "--from",
      "hello@example.com",
      "--to",
      "ada@example.com,grace@example.com",
      "--subject",
      "Hello",
      "--text",
      "It works",
      "--dry-run",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("iterable only supports 1 recipient per message");
  });

  test("dry run rejects Cloudflare messages over the recipient limit", async () => {
    const { stderr, exitCode } = await runCli([
      "send",
      "--adapter",
      "cloudflare",
      "--from",
      "hello@example.com",
      "--to",
      Array.from({ length: 51 }, (_, index) => `user${index}@example.com`).join(","),
      "--subject",
      "Hello",
      "--text",
      "It works",
      "--dry-run",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("cloudflare only supports 50 recipients per message");
  });

  test.each([
    {
      name: "Postmark with two tags",
      adapter: "postmark",
      extra: ["--tag", "one=1", "--tag", "two=2"],
      error: "postmark only supports 1 tag per message",
    },
    {
      name: "Primitive with two recipients",
      adapter: "primitive",
      to: "ada@example.com,grace@example.com",
      extra: [],
      error: "primitive only supports 1 recipient per message",
    },
    {
      name: "JetEmail without a display name",
      adapter: "jetemail",
      extra: [],
      error: "jetemail requires a from address with a display name",
    },
    {
      name: "unsupported scheduling",
      adapter: "postmark",
      extra: ["--send-at", "2026-07-21T01:00:00Z"],
      error: "does not support scheduled email",
    },
  ])("dry run rejects $name", async ({ adapter, to, extra, error }) => {
    const { stderr, exitCode } = await runCli([
      "send",
      "--adapter",
      adapter,
      "--from",
      adapter === "jetemail" ? "hello@example.com" : "Acme <hello@example.com>",
      "--to",
      to ?? "user@example.com",
      "--subject",
      "Hello",
      "--text",
      "It works",
      ...extra,
      "--dry-run",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain(error);
  });

  test("dry run maps --send-at into the validated message", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "send",
      "--adapter",
      "resend",
      "--from",
      "Acme <hello@example.com>",
      "--to",
      "user@example.com",
      "--subject",
      "Hello",
      "--text",
      "It works",
      "--send-at",
      "2026-07-21T01:00:00Z",
      "--dry-run",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).message.sendAt).toBe("2026-07-21T01:00:00Z");
  });

  test("dry run with --json wraps the plan as { ok: true, result }", async () => {
    const args = [
      "send",
      "--adapter",
      "resend",
      "--from",
      "Acme <hello@example.com>",
      "--to",
      "user@example.com",
      "--subject",
      "Hello",
      "--text",
      "It works",
      "--dry-run",
    ];

    const wrapped = await runCli([...args, "--json"]);

    expect(wrapped.stderr).toBe("");
    expect(wrapped.exitCode).toBe(0);
    expect(JSON.parse(wrapped.stdout)).toMatchObject({
      ok: true,
      result: { adapter: "resend", message: { subject: "Hello" } },
    });

    const plain = await runCli(args);

    expect(JSON.parse(plain.stdout)).toMatchObject({ ok: true, adapter: "resend" });
    expect(JSON.parse(plain.stdout)).not.toHaveProperty("result");
  });

  test("Iterable keeps adapter scheduling separate from message scheduling", async () => {
    const adapterSchedule = await runCli([
      "send",
      "--adapter",
      "iterable",
      "--from",
      "Acme <hello@example.com>",
      "--to",
      "user@example.com",
      "--subject",
      "Hello",
      "--text",
      "It works",
      "--iterable-send-at",
      "2026-07-21 01:00:00",
      "--dry-run",
    ]);

    expect(adapterSchedule.stderr).toBe("");
    expect(adapterSchedule.exitCode).toBe(0);
    expect(JSON.parse(adapterSchedule.stdout).message.sendAt).toBeUndefined();

    const messageSchedule = await runCli([
      "send",
      "--adapter",
      "iterable",
      "--from",
      "Acme <hello@example.com>",
      "--to",
      "user@example.com",
      "--subject",
      "Hello",
      "--text",
      "It works",
      "--send-at",
      "2026-07-21T01:00:00Z",
      "--dry-run",
    ]);

    expect(messageSchedule.exitCode).toBe(1);
    expect(messageSchedule.stderr).toContain("does not support scheduled email");
  });
});

describe("send routing flags", () => {
  const sendArgs = [
    "send",
    "--from",
    "hello@example.com",
    "--to",
    "user@example.com",
    "--subject",
    "Hello",
    "--text",
    "It works",
  ];

  /** Unosend at /uno answers with `unosendStatus`; Iterable at /it accepts the send. */
  function providers(unosendStatus: number) {
    const requests: string[] = [];

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        requests.push(path);

        if (path.startsWith("/uno")) {
          return Response.json({ message: "nope" }, { status: unosendStatus });
        }

        return Response.json({ code: "Success", msg: "ok" });
      },
    });

    const origin = `http://127.0.0.1:${server.port}`;

    return {
      requests,
      args: ["--adapter", "unosend", "--api-key", "uno-key", "--base-url", `${origin}/uno`],
      env: { ITERABLE_API_KEY: "it-key", ITERABLE_CAMPAIGN_ID: "7", ITERABLE_BASE_URL: `${origin}/it` },
      stop: () => server.stop(true),
    };
  }

  test("--fallback sends through the next adapter after a definite rejection", async () => {
    const fixture = providers(401);

    try {
      const { stdout, stderr, exitCode } = await runCli(
        [...sendArgs, ...fixture.args, "--fallback", "iterable", "--json"],
        fixture.env,
      );

      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({ ok: true, result: { adapter: "iterable" } });
      expect(fixture.requests).toEqual(["/uno/emails", "/it/api/email/target"]);
    } finally {
      fixture.stop();
    }
  });

  test("without --json a successful send prints the bare result as before", async () => {
    const fixture = providers(401);

    try {
      const { stdout, exitCode } = await runCli([...sendArgs, ...fixture.args, "--fallback", "iterable"], fixture.env);

      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({ adapter: "iterable" });
      expect(JSON.parse(stdout)).not.toHaveProperty("ok");
    } finally {
      fixture.stop();
    }
  });

  test("--max-attempts retries the adapter, and --json reports the route failure on stdout", async () => {
    const fixture = providers(503);

    try {
      const { stdout, stderr, exitCode } = await runCli(
        [...sendArgs, ...fixture.args, "--max-attempts", "3", "--fallback", "iterable", "--json"],
        fixture.env,
      );

      expect(exitCode).toBe(1);
      expect(stderr).toBe("");
      // A 503 leaves delivery unknown, so the default policy does not fall back to Iterable.
      expect(fixture.requests).toEqual(["/uno/emails", "/uno/emails", "/uno/emails"]);
      expect(JSON.parse(stdout)).toEqual({
        ok: false,
        error: {
          name: "EmailRouteError",
          code: "route_error",
          message: "All configured email adapters failed.",
          retryable: false,
          failures: [
            {
              name: "EmailAdapterError",
              code: "adapter_error",
              message: "unosend failed with 503: nope",
              retryable: true,
              adapter: "unosend",
              status: 503,
              delivery: "unknown",
            },
          ],
        },
      });
    } finally {
      fixture.stop();
    }
  });

  test.each([["0"], ["two"], ["1.5"]])("rejects --max-attempts %s as a usage error", async (value) => {
    const { stdout, stderr, exitCode } = await runCli([
      ...sendArgs,
      "--adapter",
      "resend",
      "--max-attempts",
      value,
      "--dry-run",
      "--json",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      ok: false,
      error: {
        name: "CliError",
        code: "cli_error",
        message: "--max-attempts must be a whole number of at least 1.",
      },
    });
  });

  test("dry run validates the message against fallback adapters and shows the route", async () => {
    const plan = await runCli([
      ...sendArgs,
      "--adapter",
      "resend",
      "--fallback",
      "postmark,resend,postmark",
      "--max-attempts",
      "2",
      "--dry-run",
    ]);

    expect(plan.exitCode).toBe(0);
    expect(JSON.parse(plan.stdout)).toMatchObject({ ok: true, adapter: "resend", fallback: ["postmark"], maxAttempts: 2 });

    // Cloudflare accepts only plain recipient addresses, so the route fails before any send.
    const rejected = await runCli([
      "send",
      "--adapter",
      "resend",
      "--fallback",
      "cloudflare",
      "--from",
      "hello@example.com",
      "--to",
      "Ada <ada@example.com>",
      "--subject",
      "Hello",
      "--text",
      "It works",
      "--dry-run",
    ]);

    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("cloudflare");
  });

  test("a plain dry run prints the same plan shape as before", async () => {
    const { stdout, exitCode } = await runCli([...sendArgs, "--adapter", "resend", "--dry-run"]);

    expect(exitCode).toBe(0);
    expect(Object.keys(JSON.parse(stdout))).toEqual(["ok", "adapter", "message"]);
  });

  test("rejects an unknown fallback adapter", async () => {
    const { stderr, exitCode } = await runCli([
      ...sendArgs,
      "--adapter",
      "resend",
      "--fallback",
      "nope",
      "--dry-run",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unsupported fallback adapter "nope"');
  });

  test("send --json reports missing and malformed --message files as JSON on stdout", async () => {
    const missing = await runCli([
      "send",
      "--adapter",
      "resend",
      "--message",
      "/tmp/email-sdk-definitely-missing-message-file.json",
      "--json",
    ]);

    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toBe("");
    expect(JSON.parse(missing.stdout)).toMatchObject({
      ok: false,
      error: {
        name: "CliError",
        code: "cli_error",
      },
    });

    const dir = mkdtempSync(join(tmpdir(), "email-sdk-bad-message-"));
    const invalidPath = join(dir, "bad.json");
    await Bun.write(invalidPath, "{not-valid-json");

    const malformed = await runCli([
      "send",
      "--adapter",
      "resend",
      "--message",
      invalidPath,
      "--json",
    ]);

    expect(malformed.exitCode).toBe(1);
    expect(malformed.stderr).toBe("");
    expect(JSON.parse(malformed.stdout)).toMatchObject({
      ok: false,
      error: {
        name: "CliError",
        code: "cli_error",
      },
    });

    const bare = await runCli(["send", "--adapter", "resend", "--message", "--json"]);
    expect(bare.exitCode).toBe(1);
    expect(bare.stderr).toBe("");
    expect(JSON.parse(bare.stdout)).toMatchObject({
      ok: false,
      error: { code: "cli_error" },
    });

    const badAttachmentPath = join(dir, "bad-attachment.json");
    await Bun.write(
      badAttachmentPath,
      JSON.stringify({
        from: "a@example.com",
        to: "b@example.com",
        subject: "hi",
        text: "hi",
        attachments: [null],
      }),
    );

    const badAttachment = await runCli([
      "send",
      "--adapter",
      "resend",
      "--message",
      badAttachmentPath,
      "--dry-run",
      "--json",
    ]);

    expect(badAttachment.exitCode).toBe(1);
    expect(badAttachment.stderr).toBe("");
    expect(JSON.parse(badAttachment.stdout)).toMatchObject({
      ok: false,
      error: { code: "validation_error" },
    });
  });
});

describe("smtp send credentials", () => {
  const smtpArgs = [
    "send",
    "--adapter",
    "smtp",
    "--host",
    "127.0.0.1",
    "--user",
    "smtp-user",
    "--pass",
    "smtp-secret",
    "--from",
    "hello@example.com",
    "--to",
    "user@example.com",
    "--subject",
    "Hello",
    "--text",
    "It works",
  ];

  const clearedSmtpEnv = {
    SMTP_HOST: undefined,
    SMTP_PORT: undefined,
    SMTP_SECURE: undefined,
    SMTP_REQUIRE_TLS: undefined,
    SMTP_ALLOW_INSECURE_AUTH: undefined,
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
  };

  /** A plaintext SMTP server that offers AUTH, refuses STARTTLS, and records every command. */
  async function plaintextAuthServer() {
    const commands: string[] = [];
    const sockets = new Set<net.Socket>();
    const closed: Promise<void>[] = [];

    const server = net.createServer((socket) => {
      sockets.add(socket);
      closed.push(new Promise((resolve) => socket.once("close", () => resolve())));
      socket.setEncoding("utf8");
      socket.write("220 test.local\r\n");
      let buffered = "";
      let inData = false;

      socket.on("data", (chunk: string) => {
        buffered += chunk;
        const lines = buffered.split("\r\n");
        buffered = lines.pop() ?? "";

        for (const line of lines) {
          if (inData) {
            if (line === ".") {
              inData = false;
              socket.write("250 queued as TEST1\r\n");
            }

            continue;
          }

          const command = line.toUpperCase();
          commands.push(command.split(" ")[0] ?? command);

          if (command.startsWith("EHLO")) {
            socket.write("250-test.local\r\n250 AUTH PLAIN LOGIN\r\n");
          } else if (command === "STARTTLS") {
            socket.write("502 5.5.1 STARTTLS not supported\r\n");
          } else if (command.startsWith("AUTH")) {
            socket.write("235 authenticated\r\n");
          } else if (command === "DATA") {
            inData = true;
            socket.write("354 go ahead\r\n");
          } else if (command === "QUIT") {
            socket.write("221 bye\r\n");
            socket.end();
          } else {
            socket.write("250 ok\r\n");
          }
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    // SAFETY: a server listening on a TCP host and port reports an AddressInfo, never a pipe path.
    const { port } = server.address() as net.AddressInfo;

    return {
      commands,
      port: String(port),
      /** Waits for the CLI's connections to close so every command it sent is recorded. */
      drain: () => Promise.all(closed),
      stop: async () => {
        for (const socket of sockets) socket.destroy();

        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  async function sendAgainst(extraArgs: string[], env: Record<string, string | undefined> = {}) {
    const server = await plaintextAuthServer();

    try {
      const result = await runCli([...smtpArgs, "--port", server.port, ...extraArgs], {
        ...clearedSmtpEnv,
        ...env,
      });

      await server.drain();

      return { ...result, commands: server.commands };
    } finally {
      await server.stop();
    }
  }

  test("refuses to authenticate over plaintext when the server offers no STARTTLS", async () => {
    const { stdout, stderr, exitCode, commands } = await sendAgainst([]);

    expect(exitCode).toBe(1);
    expect(commands).toContain("STARTTLS");
    expect(commands).not.toContain("AUTH");
    expect(stdout + stderr).not.toContain("smtp-secret");
  });

  test("--allow-insecure-auth still authenticates over plaintext when asked to", async () => {
    const { stderr, exitCode, commands } = await sendAgainst(["--allow-insecure-auth"]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(commands.filter((command) => command === "AUTH")).toHaveLength(1);
  });

  test("--allow-insecure-auth=false overrides SMTP_ALLOW_INSECURE_AUTH=true", async () => {
    const { exitCode, commands } = await sendAgainst(["--allow-insecure-auth=false"], {
      SMTP_ALLOW_INSECURE_AUTH: "true",
    });

    expect(exitCode).toBe(1);
    expect(commands).not.toContain("AUTH");
  });
});

describe("workflows inspect", () => {
  const fixture = "test-support/onboarding-workflow.ts";

  test("prints the workflow graph as JSON without sending", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "workflows",
      "inspect",
      fixture,
      "--export",
      "onboarding",
      "--input",
      '{"email":"ada@example.com","name":"Ada"}',
      "--events",
      '{"activated":{"plan":"pro"}}',
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const graph = JSON.parse(stdout);

    expect(graph.workflow).toBe("onboarding");
    expect(graph.cancelOn).toEqual(["unsubscribed"]);
    expect(graph.paths.map((path: { outcome: unknown }) => path.outcome)).toEqual([
      { status: "completed", output: { outcome: "activated" } },
      { status: "completed", output: { outcome: "nudged" } },
    ]);
    expect(graph.nodes.find((node: { id: string }) => node.id === "welcome").email.subject).toBe("Welcome, Ada");
  });

  test("prints mermaid and text, reading input from a file and picking the only workflow export", async () => {
    const dir = mkdtempSync(join(tmpdir(), "email-sdk-workflows-"));
    const inputPath = join(dir, "input.json");

    await Bun.write(inputPath, '{"email":"ada@example.com"}');

    const mermaid = await runCli(["workflows", "inspect", fixture, "--input", `@${inputPath}`, "--format", "mermaid"]);

    expect(mermaid.exitCode).toBe(0);
    expect(mermaid.stdout).toStartWith("flowchart TD\n");
    expect(mermaid.stdout).toContain("n4 -->|timeout| n6");
    expect(mermaid.stdout).toContain("Welcome, there");
    // Without --events the received branch has no payload, and the failure says how to fix it.
    expect(mermaid.stdout).toContain('#quot;activated#quot; had no sample payload; pass one in events');

    const text = await runCli(["workflows", "inspect", fixture, "--input=@" + inputPath, "--format", "text"]);

    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain("path-2 [activated timeout]: completed after 5d");
  });

  test("reports usage errors on stderr with exit code 1", async () => {
    const cases: [string[], string][] = [
      [["workflows", "list"], 'Unknown workflows action "list"'],
      [["workflows", "inspect"], "Pass the module"],
      [["workflows", "inspect", fixture, "--format", "svg"], 'Unknown --format "svg"'],
      [["workflows", "inspect", fixture, "--input", "{nope"], "--input is not valid JSON"],
      [["workflows", "inspect", fixture, "--events", "[]"], "--events must be a JSON object"],
      [["workflows", "inspect", fixture, "--export", "notAWorkflow"], 'has no workflow export "notAWorkflow"'],
      [["workflows", "inspect", fixture, "--input", "{}"], "Invalid input for workflow onboarding"],
      [["workflows", "inspect", "missing-module.ts"], "Could not import missing-module.ts"],
      [["workflows", "inspect", fixture, "--max-paths", "0"], "--max-paths must be a positive integer"],
      [["workflows", "inspect", fixture, "--format"], "--format needs a value"],
      [["workflows", "inspect", fixture, "--export"], "--export needs a value"],
      [["workflows", "inspect", fixture, "--max-depth"], "--max-depth needs a value"],
      [["workflows", "inspect", fixture, "--subject", "ada@example.com", "--subject"], "--subject can be given only once"],
    ];

    for (const [args, message] of cases) {
      const { stderr, exitCode } = await runCli(args);

      expect(exitCode).toBe(1);
      expect(stderr).toContain(message);
    }
  });
});

describe("telemetry command", () => {
  test("managing telemetry never reports events, while other commands do", async () => {
    const configHome = mkdtempSync(join(tmpdir(), "email-sdk-cli-telemetry-"));

    const run = async (args: string[]) => {
      const proc = Bun.spawn({
        cmd: ["bun", "--preload", "./test-support/fetch-trap.ts", "src/cli.ts", ...args],
        cwd: new URL("..", import.meta.url).pathname,
        // Telemetry has to be live here for the trap to observe it.
        env: { PATH: process.env.PATH, HOME: configHome, XDG_CONFIG_HOME: configHome },
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      return { stdout, sent: stderr.includes("FETCH_TRAP") };
    };

    expect(await run(["telemetry", "status"])).toMatchObject({ sent: false });
    expect(await run(["telemetry", "bogus"])).toMatchObject({ sent: false });
    expect(await run(["adapters"])).toMatchObject({ sent: true });

    const disabled = await run(["telemetry", "disable"]);
    expect(disabled.sent).toBe(false);
    expect(await run(["adapters"])).toMatchObject({ sent: false });
    expect((await run(["telemetry", "status"])).stdout).toContain("Telemetry is disabled");
  });
});

async function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  const packageRoot = new URL("..", import.meta.url).pathname;

  const proc = Bun.spawn({
    cmd: ["bun", "--no-env-file", "src/cli.ts", ...args],
    cwd: packageRoot,
    // NODE_ENV=test already disables telemetry; the explicit opt-out keeps these
    // tests network-free even if env propagation changes.
    env: { ...process.env, ...env, EMAIL_SDK_TELEMETRY: "0" },
    timeout: 30_000,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}
