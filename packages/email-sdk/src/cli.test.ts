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
});

async function runCli(args: string[]) {
  const packageRoot = new URL("..", import.meta.url).pathname;
  const proc = Bun.spawn({
    cmd: ["bun", "src/cli.ts", ...args],
    cwd: packageRoot,
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
