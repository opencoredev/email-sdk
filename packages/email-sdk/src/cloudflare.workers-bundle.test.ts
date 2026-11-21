import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import type { cloudflare as cloudflareFactory, CloudflareSendEmailMessage } from "./cloudflare.js";

const CLOUDFLARE_ENTRY = join(import.meta.dir, "cloudflare.ts");

/** Bundles the Cloudflare adapter the way an edge bundler would: browser target, Node built-ins left external. */
async function bundleCloudflare(format: "esm" | "iife") {
  const dir = await mkdtemp(join(tmpdir(), "email-sdk-workers-"));
  const entry = join(dir, "entry.ts");

  await writeFile(
    entry,
    format === "iife"
      ? `import { cloudflare } from ${JSON.stringify(CLOUDFLARE_ENTRY)};\nglobalThis.cloudflare = cloudflare;\n`
      : `export { cloudflare } from ${JSON.stringify(CLOUDFLARE_ENTRY)};\n`,
  );

  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format,
    external: ["node:*"],
  });

  expect(result.success).toBe(true);
  const [output] = result.outputs;

  if (!output) throw new Error("Bun.build produced no output.");

  return output.text();
}

type WorkersSandbox = {
  cloudflare?: typeof cloudflareFactory;
  btoa: typeof btoa;
  atob: typeof atob;
  TextEncoder: typeof TextEncoder;
  Blob: typeof Blob;
};

describe("@opencoredev/email-sdk/cloudflare in a Workers-style bundle", () => {
  test("has no static Node built-in import and no Buffer or process reference", async () => {
    const code = await bundleCloudflare("esm");
    const nodeOnly = /(?:from|import)\s*["']node:|require\(\s*["']node:|\bBuffer\b|\bprocess\./;

    // Report only the offending lines so a regression names the culprit instead of the whole bundle.
    expect(code.split("\n").filter((line) => nodeOnly.test(line))).toEqual([]);
  });

  test("sends through a binding with no Buffer, process, or node:fs in the global scope", async () => {
    const code = await bundleCloudflare("iife");

    // A fresh realm with only the Web APIs Workers provide: no Buffer, process, or require.
    const sandbox: WorkersSandbox = { btoa, atob, TextEncoder, Blob };
    runInNewContext(code, sandbox);

    const cloudflare = sandbox.cloudflare;

    if (!cloudflare) throw new Error("The bundle did not expose cloudflare().");
    const sent: CloudflareSendEmailMessage[] = [];

    const adapter = cloudflare({
      binding: {
        async send(message) {
          sent.push(message);

          return { messageId: "cf_1" };
        },
      },
    });

    const result = await adapter.send(
      {
        from: "sender@example.com",
        to: "user@example.com",
        subject: "Workers",
        text: "Hello from a Worker",
        attachments: [
          { filename: "hello.txt", content: "héllo", contentType: "text/plain" },
          { filename: "bytes.bin", content: new Uint8Array([0, 1, 2, 255]) },
        ],
      },
      { adapter: "cloudflare", operation: "send", attempt: 1 },
    );

    expect(result.id).toBe("cf_1");
    expect(sent[0]?.attachments?.map((attachment) => attachment.content)).toEqual([
      "aMOpbGxv",
      "AAEC/w==",
    ]);
  });

  test("rejects a path attachment with a clear error when node:fs is unavailable", async () => {
    const code = await bundleCloudflare("iife");
    const sandbox: WorkersSandbox = { btoa, atob, TextEncoder, Blob };
    runInNewContext(code, sandbox);

    const cloudflare = sandbox.cloudflare;

    if (!cloudflare) throw new Error("The bundle did not expose cloudflare().");

    const adapter = cloudflare({
      binding: {
        async send() {
          return { messageId: "never" };
        },
      },
    });

    const sending = adapter.send(
      {
        from: "sender@example.com",
        to: "user@example.com",
        subject: "Workers",
        text: "Hello",
        attachments: [{ filename: "report.pdf", path: "/tmp/report.pdf" }],
      },
      { adapter: "cloudflare", operation: "send", attempt: 1 },
    );

    expect(sending).rejects.toThrow(/Attachments given by path need a runtime with node:fs\/promises/);
  });
});
