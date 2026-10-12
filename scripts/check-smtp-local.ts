// Credential-free SMTP end-to-end check. Starts an owned Mailpit container on
// loopback ports, sends through the SDK and the built CLI, then reads the
// parsed messages back from Mailpit's API. Never touches a real mail server.
// Set KEEP_MAILPIT=1 to leave the container running for manual inspection.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { smtp } from "../packages/email-sdk/src/smtp.js";

const MAILPIT_IMAGE = "axllent/mailpit:v1.27.8";

const CLI_PATH = "packages/email-sdk/dist/cli.js";

const SDK_SOURCE_DIR = "packages/email-sdk/src";

const REQUEST_TIMEOUT_MS = 5_000;

const containerName = `email-sdk-smtp-check-${process.pid}`;

const address = z.object({ Name: z.string(), Address: z.string() });

const summarySchema = z.object({
  messages: z.array(z.object({ ID: z.string(), Subject: z.string() })),
});

const messageSchema = z.object({
  Subject: z.string(),
  MessageID: z.string(),
  From: address,
  To: z.array(address),
  Cc: z.array(address),
  Bcc: z.array(address),
  ReplyTo: z.array(address),
  Text: z.string(),
  HTML: z.string(),
  Attachments: z.array(z.object({ PartID: z.string(), FileName: z.string() })),
  Inline: z.array(z.object({ PartID: z.string(), FileName: z.string(), ContentID: z.string() })),
});

const headersSchema = z.record(z.string(), z.array(z.string()));

type Observed = string | number | boolean | null | undefined | readonly Observed[] | Address;

type Address = z.infer<typeof address>;

type Check = { name: string; ok: boolean; detail?: string };

const checks: Check[] = [];

function expectEqual(name: string, actual: Observed, expected: Observed): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);

  checks.push(
    ok
      ? { name, ok }
      : { name, ok, detail: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` },
  );
}

function docker(args: readonly string[]): string {
  const result = spawnSync("docker", args, { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`docker ${args[0]} failed: ${result.stderr.trim()}`);
  }

  return result.stdout.trim();
}

function hostPort(containerPort: number): number {
  const mapping = docker(["port", containerName, `${containerPort}/tcp`]).split("\n")[0] ?? "";

  const port = Number(mapping.slice(mapping.lastIndexOf(":") + 1));

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Could not read host port for ${containerPort}/tcp from "${mapping}".`);
  }

  return port;
}

async function waitForReady(apiBase: string): Promise<void> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const ready = await fetch(`${apiBase}/readyz`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).then(
      (response) => response.ok,
      () => false,
    );

    if (ready) return;

    await sleep(250);
  }

  throw new Error(`Mailpit at ${apiBase} did not become ready within 20s.`);
}

async function get(url: string): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status}.`);
  }

  return response;
}

async function getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await (await get(url)).json());
}

async function getPartBase64(apiBase: string, messageId: string, partId: string): Promise<string> {
  const bytes = await (await get(`${apiBase}/api/v1/message/${messageId}/part/${partId}`)).bytes();

  return Buffer.from(bytes).toString("base64");
}

async function findMessage(apiBase: string, subject: string) {
  const summary = await getJson(`${apiBase}/api/v1/messages`, summarySchema);

  const match = summary.messages.find((message) => message.Subject === subject);

  if (!match) {
    throw new Error(`Mailpit has no message with subject "${subject}".`);
  }

  const message = await getJson(`${apiBase}/api/v1/message/${match.ID}`, messageSchema);

  const headers = await getJson(`${apiBase}/api/v1/message/${match.ID}/headers`, headersSchema);

  return { id: match.ID, message, headers };
}

const ATTACHMENT_TEXT = "attachment body\n";

const INLINE_PNG_BASE64 = "iVBORw0KGgo=";

async function checkSdkSend(smtpPort: number, apiBase: string): Promise<void> {
  const subject = "Grüße from Email SDK ✉️";

  const email = createEmailClient({
    adapters: [smtp({ host: "127.0.0.1", port: smtpPort, timeoutMs: 5_000 })],
    telemetry: false,
  });

  await email.send(
    {
      from: { name: "SDK Check", email: "sender@example.test" },
      to: "to@example.test",
      cc: "cc@example.test",
      bcc: "bcc@example.test",
      replyTo: "reply@example.test",
      subject,
      text: "Plain body with ünïcode and a line that is long enough to need soft wrapping in quoted-printable encoding, which is what SMTP transports have to get right.",
      html: '<p>HTML body</p><img src="cid:logo@example.test">',
      headers: [{ name: "X-Email-SDK-Check", value: "sdk" }],
      attachments: [
        { filename: "report.txt", content: ATTACHMENT_TEXT, contentType: "text/plain" },
        {
          filename: "logo.png",
          content: INLINE_PNG_BASE64,
          contentEncoding: "base64",
          contentType: "image/png",
          contentId: "logo@example.test",
          disposition: "inline",
        },
      ],
    },
    { idempotencyKey: "smtp-local-check" },
  );

  const { id, message, headers } = await findMessage(apiBase, subject);

  expectEqual("sdk: non-ASCII subject round-trips", message.Subject, subject);
  expectEqual("sdk: from name and address", message.From, {
    Name: "SDK Check",
    Address: "sender@example.test",
  });
  expectEqual(
    "sdk: to",
    message.To.map((entry) => entry.Address),
    ["to@example.test"],
  );
  expectEqual(
    "sdk: cc",
    message.Cc.map((entry) => entry.Address),
    ["cc@example.test"],
  );
  expectEqual(
    "sdk: bcc delivered as envelope recipient",
    message.Bcc.map((entry) => entry.Address),
    ["bcc@example.test"],
  );
  // Mailpit prepends a synthetic Bcc header for envelope-only recipients, so it
  // cannot prove the header was omitted; smtp.test.ts asserts that on raw DATA.
  expectEqual(
    "sdk: reply-to",
    message.ReplyTo.map((entry) => entry.Address),
    ["reply@example.test"],
  );
  expectEqual(
    "sdk: text body decodes",
    message.Text.trim().startsWith("Plain body with ünïcode"),
    true,
  );
  expectEqual("sdk: html body present", message.HTML.includes("<p>HTML body</p>"), true);
  expectEqual(
    "sdk: html references inline image",
    message.HTML.includes('src="cid:logo@example.test"'),
    true,
  );
  expectEqual("sdk: custom header", headers["X-Email-Sdk-Check"] ?? headers["X-Email-SDK-Check"], [
    "sdk",
  ]);
  expectEqual("sdk: idempotency Message-ID", message.MessageID, "smtp-local-check@email-sdk.local");
  expectEqual(
    "sdk: file attachment",
    message.Attachments.map((entry) => entry.FileName),
    ["report.txt"],
  );
  expectEqual(
    "sdk: inline attachment content ID",
    message.Inline.map((entry) => entry.ContentID),
    ["logo@example.test"],
  );

  const [file] = message.Attachments;

  const [inline] = message.Inline;

  if (file) {
    expectEqual(
      "sdk: file attachment bytes",
      await getPartBase64(apiBase, id, file.PartID),
      Buffer.from(ATTACHMENT_TEXT).toString("base64"),
    );
  }

  if (inline) {
    expectEqual(
      "sdk: inline attachment bytes",
      await getPartBase64(apiBase, id, inline.PartID),
      INLINE_PNG_BASE64,
    );
  }
}

// Drop inherited SMTP_* settings (TLS, auth) so the CLI talks plain SMTP to
// Mailpit. The child also runs with --no-env-file, because Bun would otherwise
// reload them from the repo-root .env and .env.local.
function cliEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("SMTP_")),
  );

  return { ...env, EMAIL_SDK_TELEMETRY: "0" };
}

async function checkCliSend(smtpPort: number, apiBase: string): Promise<void> {
  const subject = "Email SDK CLI SMTP check";

  const result = spawnSync(
    process.execPath,
    [
      "--no-env-file",
      CLI_PATH,
      "send",
      "--adapter",
      "smtp",
      "--host",
      "127.0.0.1",
      "--port",
      String(smtpPort),
      "--from",
      "cli@example.test",
      "--to",
      "to@example.test",
      "--subject",
      subject,
      "--text",
      "Sent by the built CLI.",
      "--header",
      "X-Email-SDK-Check:cli",
    ],
    { encoding: "utf8", env: cliEnv() },
  );

  expectEqual("cli: exit status", result.status, 0);

  if (result.status !== 0) {
    checks.push({ name: "cli: stderr", ok: false, detail: result.stderr.trim() });

    return;
  }

  const { message } = await findMessage(apiBase, subject);

  expectEqual("cli: from", message.From.Address, "cli@example.test");
  expectEqual("cli: text body", message.Text.trim(), "Sent by the built CLI.");
}

function newestSourceMtime(dir: string): number {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .reduce((newest, file) => Math.max(newest, statSync(`${dir}/${file}`).mtimeMs), 0);
}

function assertFreshCli(): void {
  if (!existsSync(CLI_PATH)) {
    throw new Error(`${CLI_PATH} is missing. Run "bun run build" first.`);
  }

  if (newestSourceMtime(SDK_SOURCE_DIR) > statSync(CLI_PATH).mtimeMs) {
    throw new Error(`${CLI_PATH} is older than ${SDK_SOURCE_DIR}. Run "bun run build" first.`);
  }
}

let containerRemoved = false;

function removeContainer(): void {
  if (containerRemoved || process.env.KEEP_MAILPIT === "1") return;

  containerRemoved = true;

  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore" });
}

async function main(): Promise<void> {
  assertFreshCli();

  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "-p",
    "127.0.0.1::1025",
    "-p",
    "127.0.0.1::8025",
    MAILPIT_IMAGE,
  ]);

  // finally blocks don't run when the process is killed, so remove the
  // container from the signal handlers too.
  process.once("SIGINT", () => {
    removeContainer();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    removeContainer();
    process.exit(143);
  });

  let smtpPort = 0;

  let apiBase = "";

  try {
    smtpPort = hostPort(1025);
    apiBase = `http://127.0.0.1:${hostPort(8025)}`;
    await waitForReady(apiBase);
    await checkSdkSend(smtpPort, apiBase);
    await checkCliSend(smtpPort, apiBase);
  } finally {
    if (process.env.KEEP_MAILPIT === "1") {
      console.error(`Kept ${containerName}: Mailpit UI ${apiBase}, SMTP 127.0.0.1:${smtpPort}`);
    }

    removeContainer();
  }
}

try {
  await main();
} catch (error) {
  checks.push({
    name: "harness",
    ok: false,
    detail: error instanceof Error ? error.message : String(error),
  });
}

const failed = checks.filter((check) => !check.ok);

console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));

if (failed.length > 0) process.exit(1);
