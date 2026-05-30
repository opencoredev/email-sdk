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
