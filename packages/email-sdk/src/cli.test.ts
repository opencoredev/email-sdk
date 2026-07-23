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

async function runCli(args: string[]) {
  const packageRoot = new URL("..", import.meta.url).pathname;
  const proc = Bun.spawn({
    cmd: ["bun", "src/cli.ts", ...args],
    cwd: packageRoot,
    // NODE_ENV=test already disables telemetry; the explicit opt-out keeps these
    // tests network-free even if env propagation changes.
    env: { ...process.env, EMAIL_SDK_TELEMETRY: "0" },
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
