import { describe, expect, test } from "bun:test";

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

async function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  const packageRoot = new URL("..", import.meta.url).pathname;
  const proc = Bun.spawn({
    cmd: ["bun", "src/cli.ts", ...args],
    cwd: packageRoot,
    // NODE_ENV=test already disables telemetry; the explicit opt-out keeps these
    // tests network-free even if env propagation changes.
    env: { ...process.env, ...env, EMAIL_SDK_TELEMETRY: "0" },
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
