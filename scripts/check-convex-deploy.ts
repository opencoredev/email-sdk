// Credential-free Convex deploy check for @opencoredev/convex-email.
//
// convex-test does not apply Convex's deploy rules (for example, no "use node" modules inside a
// component), so a green unit suite can still ship a component that no deployment accepts. This
// script packs the built packages, scaffolds a scratch Convex app that mounts the component, and
// deploys it to a local Convex backend in anonymous agent mode (no Convex account). It then sends
// one email through the app's sender action to a loopback Resend fixture, posts a signed Resend
// webhook and an unsigned-provider webhook, and reads the results back through the app's
// functions. Everything runs in a temp directory that is removed afterwards.
//
// Needs network access for `npm install` and, on first run, the Convex backend binary download.
// Set KEEP_CONVEX_APP=1 to keep the scratch app for inspection.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

const REPO_ROOT = resolve(import.meta.dirname, "..");

const PACKAGES = [
  { dir: "packages/email-sdk", name: "@opencoredev/email-sdk" },
  { dir: "packages/convex-email", name: "@opencoredev/convex-email" },
] as const;

const READY_TIMEOUT_MS = 240_000;

const SEND_TIMEOUT_MS = 60_000;

const REQUEST_TIMEOUT_MS = 10_000;

const FIXTURE_API_KEY = "re_convex_deploy_check";

const FIXTURE_MESSAGE_ID = "convex-deploy-check-message";

const CUSTOM_WEBHOOK_TOKEN = "convex-deploy-check-token";

const webhookSecretBytes = randomBytes(32);

const webhookSecret = `whsec_${webhookSecretBytes.toString("base64")}`;

type Observed = string | number | boolean | null | undefined | readonly Observed[];

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

function newestMtime(path: string): number {
  const stats = statSync(path);

  if (!stats.isDirectory()) return stats.mtimeMs;

  return Math.max(stats.mtimeMs, ...readdirSync(path).map((entry) => newestMtime(join(path, entry))));
}

function assertBuilt(dir: string): void {
  const dist = join(REPO_ROOT, dir, "dist");
  const src = join(REPO_ROOT, dir, "src");

  let distMtime: number;

  try {
    distMtime = newestMtime(dist);
  } catch {
    throw new Error(`${dir}/dist is missing. Run \`bun run build\` first.`);
  }

  if (newestMtime(src) > distMtime) {
    throw new Error(`${dir}/dist is older than ${dir}/src. Run \`bun run build\` first.`);
  }
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }

  return result.stdout.trim();
}

const installedConvex = z.object({ version: z.string() });

function convexVersion(): string {
  const manifest = join(REPO_ROOT, "packages/convex-email/node_modules/convex/package.json");

  return installedConvex.parse(JSON.parse(readFileSync(manifest, "utf8"))).version;
}

type FixtureRequest = { method?: string; url?: string; authorization?: string; body: string };

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

/** A loopback stand-in for the Resend API that records every request it receives. */
async function startResendFixture(): Promise<{ server: Server; url: string; requests: FixtureRequest[] }> {
  const requests: FixtureRequest[] = [];

  const server = createServer((request, response) => {
    void readBody(request).then((body) => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: FIXTURE_MESSAGE_ID }));
    });
  });

  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

  const { port }: AddressInfo = z
    .object({ port: z.number(), address: z.string(), family: z.string() })
    .parse(server.address());

  return { server, url: `http://127.0.0.1:${port}`, requests };
}

function scaffoldApp(appDir: string, tarballs: readonly string[], fixtureUrl: string): void {
  const convexDir = join(appDir, "convex");
  mkdirSync(convexDir, { recursive: true });

  writeFileSync(
    join(appDir, "package.json"),
    JSON.stringify({ name: "convex-email-deploy-check", private: true, type: "module" }, null, 2),
  );

  writeFileSync(
    join(convexDir, "convex.config.ts"),
    `import convexEmail from "@opencoredev/convex-email/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(convexEmail);

export default app;
`,
  );

  writeFileSync(
    join(convexDir, "emailSender.ts"),
    `"use node";

import { emailSender } from "@opencoredev/convex-email/node";

import { components } from "./_generated/api";

export const send = emailSender(components.convexEmail, { telemetry: false });
`,
  );

  writeFileSync(
    join(convexDir, "email.ts"),
    `import { ConvexEmail } from "@opencoredev/convex-email";

import { components, internal } from "./_generated/api";

// The annotation breaks the type cycle through \`internal\`, which includes this module.
export const email: ConvexEmail = new ConvexEmail(components.convexEmail, {
  sender: internal.emailSender.send,
  adapters: [{ kind: "resend", baseUrl: ${JSON.stringify(fixtureUrl)} }],
  defaultAdapter: "resend",
  maxAttempts: 1,
});
`,
  );

  writeFileSync(
    join(convexDir, "emails.ts"),
    `import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { email } from "./email";

export const send = mutation({
  args: { to: v.string(), subject: v.string() },
  handler: async (ctx, args) =>
    await email.send(ctx, {
      from: "Deploy Check <check@example.test>",
      to: args.to,
      subject: args.subject,
      text: "Sent by scripts/check-convex-deploy.ts.",
    }),
});

export const status = query({
  args: { emailId: v.string() },
  handler: async (ctx, args) => await email.status(ctx, args),
});

export const events = query({
  args: { emailId: v.string() },
  handler: async (ctx, args) => (await email.listEvents(ctx, args)).map((event) => event.type),
});
`,
  );

  writeFileSync(
    join(convexDir, "http.ts"),
    `import { resendWebhookVerifier, verifyByProvider } from "@opencoredev/convex-email";
import { httpRouter } from "convex/server";

import { email } from "./email";

const http = httpRouter();

email.registerRoutes(http, {
  providers: ["resend", "acme"],
  verify: verifyByProvider({
    resend: resendWebhookVerifier({ secret: ${JSON.stringify(webhookSecret)} }),
    acme: ({ headers }) => headers["x-acme-token"] === ${JSON.stringify(CUSTOM_WEBHOOK_TOKEN)},
  }),
});

export default http;
`,
  );

  run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--loglevel=error", `convex@${convexVersion()}`, "typescript@5", ...tarballs],
    appDir,
  );
}

/**
 * The environment for every Convex CLI call. Deploy keys, deployment names, and self-hosted URLs
 * take precedence over anonymous mode, so inheriting any of them could push this scratch app to a
 * real deployment. Drop every CONVEX_* variable and select the anonymous local backend explicitly.
 */
function convexEnv(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("CONVEX_")));

  return { ...env, CONVEX_AGENT_MODE: "anonymous" };
}

/** What a SIGINT or SIGTERM must clean up: the Convex process group and the scratch directory. */
type OwnedResources = { convex?: ChildProcess; workDir?: string };

const owned: OwnedResources = {};

function cleanUpOwnedSync(): void {
  if (owned.convex) signalGroup(owned.convex, "SIGKILL");

  if (owned.workDir && process.env.KEEP_CONVEX_APP !== "1") {
    rmSync(owned.workDir, { recursive: true, force: true });
  }
}

for (const [signal, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  process.once(signal, () => {
    cleanUpOwnedSync();
    process.exit(code);
  });
}

/** Starts `convex dev` and resolves once the first push succeeded, or rejects with its output. */
async function startConvexDev(appDir: string): Promise<{ child: ChildProcess; output: () => string }> {
  const child = spawn("npx", ["convex", "dev", "--tail-logs", "disable"], {
    cwd: appDir,
    env: convexEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so stopping it also stops the local backend it launches.
    detached: true,
  });

  owned.convex = child;

  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));

  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (/functions ready/i.test(output)) {
      return { child, output: () => output };
    }

    if (child.exitCode !== null || /✖|error:/i.test(output)) {
      // Give the CLI a moment to flush the rest of the error before reporting it.
      await sleep(500);
      await stopChild(child);
      throw new Error(`convex dev failed:\n${output}`);
    }

    await sleep(250);
  }

  await stopChild(child);
  throw new Error(`convex dev did not finish its first push within ${READY_TIMEOUT_MS / 1000}s:\n${output}`);
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;

  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group already exited.
  }
}

/** Stops `convex dev` and everything it started, escalating to SIGKILL after 10 seconds. */
async function stopChild(child: ChildProcess): Promise<void> {
  const exited =
    child.exitCode === null && child.signalCode === null
      ? new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()))
      : Promise.resolve();

  signalGroup(child, "SIGINT");

  const timedOut = await Promise.race([exited.then(() => false), sleep(10_000).then(() => true)]);

  // Children of the group (the local backend) can outlive the CLI, so always sweep the group.
  signalGroup(child, timedOut ? "SIGKILL" : "SIGTERM");
}

const deploymentUrls = z.object({ CONVEX_URL: z.string().url(), CONVEX_SITE_URL: z.string().url() });

function readDeploymentUrls(appDir: string): z.infer<typeof deploymentUrls> {
  const entries = readFileSync(join(appDir, ".env.local"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");

      return [line.slice(0, separator), line.slice(separator + 1)];
    });

  return deploymentUrls.parse(Object.fromEntries(entries));
}

const functionResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), value: z.json() }),
  z.object({ status: z.literal("error"), errorMessage: z.string() }),
]);

async function callFunction(
  convexUrl: string,
  kind: "query" | "mutation",
  path: string,
  args: Record<string, string>,
): Promise<z.infer<typeof z.json>> {
  const response = await fetch(`${convexUrl}/api/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const result = functionResult.parse(await response.json());

  if (result.status === "error") {
    throw new Error(`${kind} ${path} failed: ${result.errorMessage}`);
  }

  return result.value;
}

const emailStatus = z.object({
  status: z.string(),
  providerMessageId: z.string().optional(),
  attemptedAdapters: z.array(z.string()),
  deliveryStatus: z.string().optional(),
  lastError: z.string().optional(),
});

async function readStatus(convexUrl: string, emailId: string): Promise<z.infer<typeof emailStatus>> {
  return emailStatus.parse(await callFunction(convexUrl, "query", "emails:status", { emailId }));
}

async function readEvents(convexUrl: string, emailId: string): Promise<string[]> {
  return z.array(z.string()).parse(await callFunction(convexUrl, "query", "emails:events", { emailId }));
}

async function waitForStatus(
  convexUrl: string,
  emailId: string,
  done: (status: z.infer<typeof emailStatus>) => boolean,
): Promise<z.infer<typeof emailStatus>> {
  const deadline = Date.now() + SEND_TIMEOUT_MS;
  let status = await readStatus(convexUrl, emailId);

  while (!done(status) && Date.now() < deadline) {
    await sleep(500);
    status = await readStatus(convexUrl, emailId);
  }

  return status;
}

function signedResendHeaders(id: string, body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", webhookSecretBytes).update(`${id}.${timestamp}.${body}`).digest("base64");

  return { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` };
}

async function postWebhook(url: string, headers: Record<string, string>, body: string): Promise<number> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  await response.body?.cancel();

  return response.status;
}

const sentRequest = z.object({ subject: z.string(), to: z.array(z.string()), from: z.string() });

async function verifyDeployment(appDir: string, fixture: Awaited<ReturnType<typeof startResendFixture>>): Promise<void> {
  const { CONVEX_URL: convexUrl, CONVEX_SITE_URL: siteUrl } = readDeploymentUrls(appDir);

  // Never write to anything but the loopback backend this script started.
  for (const url of [convexUrl, siteUrl]) {
    if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
      throw new Error(`Refusing to continue: the scratch app is linked to ${url}, not a local backend.`);
    }
  }

  run("npx", ["convex", "env", "set", "RESEND_API_KEY", FIXTURE_API_KEY], appDir, convexEnv());

  const emailId = z
    .string()
    .parse(await callFunction(convexUrl, "mutation", "emails:send", { to: "ada@example.test", subject: "Deploy check" }));

  const sent = await waitForStatus(convexUrl, emailId, (status) => status.status === "sent" || status.status === "failed");

  expectEqual("email reaches sent through the app's sender action", sent.status, "sent");
  expectEqual("no send error recorded", sent.lastError, undefined);
  expectEqual("provider message id comes from the fixture", sent.providerMessageId, FIXTURE_MESSAGE_ID);
  expectEqual("attempt recorded against resend", sent.attemptedAdapters, ["resend"]);
  expectEqual("event history", await readEvents(convexUrl, emailId), [
    "queued",
    "processing",
    "provider_attempt",
    "sent",
  ]);

  expectEqual("fixture received one provider request", fixture.requests.length, 1);
  const [request] = fixture.requests;
  expectEqual("provider request hits POST /emails", [request?.method, request?.url], ["POST", "/emails"]);
  expectEqual("provider request carries the deployment's API key", request?.authorization, `Bearer ${FIXTURE_API_KEY}`);

  const body = sentRequest.safeParse(JSON.parse(request?.body ?? "null"));
  expectEqual(
    "provider request carries the message",
    body.success ? [body.data.subject, body.data.to, body.data.from] : body.error.message,
    ["Deploy check", ["ada@example.test"], "Deploy Check <check@example.test>"],
  );

  const resendBody = JSON.stringify({ type: "email.delivered", data: { email_id: FIXTURE_MESSAGE_ID } });
  const resendUrl = `${siteUrl}/email/webhooks/resend`;

  expectEqual("unsigned Resend webhook is rejected", await postWebhook(resendUrl, {}, resendBody), 401);
  expectEqual(
    "signed Resend webhook is accepted",
    await postWebhook(resendUrl, signedResendHeaders("msg_deploy_check", resendBody), resendBody),
    200,
  );

  const delivered = await waitForStatus(convexUrl, emailId, (status) => status.deliveryStatus === "delivered");
  expectEqual("webhook marks the email delivered", delivered.deliveryStatus, "delivered");

  // A provider without a dedicated parser goes through the component's generic path, which hashes
  // the body for its delivery id with Web Crypto in Convex's default runtime.
  const acmeUrl = `${siteUrl}/email/webhooks/acme`;
  const acmeBody = JSON.stringify({ event: "opened", messageId: FIXTURE_MESSAGE_ID });
  const acmeHeaders = { "x-acme-token": CUSTOM_WEBHOOK_TOKEN };

  expectEqual("generic webhook is accepted", await postWebhook(acmeUrl, acmeHeaders, acmeBody), 200);
  expectEqual("generic webhook redelivery is accepted", await postWebhook(acmeUrl, acmeHeaders, acmeBody), 200);
  expectEqual(
    "generic webhook redelivery is deduplicated (one Resend + one generic webhook event)",
    (await readEvents(convexUrl, emailId)).filter((type) => type === "webhook").length,
    2,
  );
}

async function main(): Promise<void> {
  for (const { dir } of PACKAGES) {
    assertBuilt(dir);
  }

  const workDir = mkdtempSync(join(tmpdir(), "convex-email-deploy-"));
  owned.workDir = workDir;
  const appDir = join(workDir, "app");
  const fixture = await startResendFixture();
  let convex: ChildProcess | undefined;

  try {
    const tarballs = PACKAGES.map(({ dir }) =>
      join(
        workDir,
        run("npm", ["pack", "--silent", "--pack-destination", workDir], join(REPO_ROOT, dir), {
          ...process.env,
          EMAIL_SDK_RELEASE_PREBUILT: "1",
        })
          .split("\n")
          .at(-1) ?? "",
      ),
    );

    scaffoldApp(appDir, tarballs, fixture.url);

    const dev = await startConvexDev(appDir);
    convex = dev.child;
    checks.push({ name: "component deploys to a local Convex backend", ok: true });

    await verifyDeployment(appDir, fixture);
  } catch (error) {
    checks.push({ name: "deploy check ran to completion", ok: false, detail: String(error) });
  } finally {
    if (convex) {
      await stopChild(convex);
    }

    fixture.server.closeAllConnections();
    fixture.server.close();

    if (process.env.KEEP_CONVEX_APP === "1") {
      console.error(`Kept scratch app at ${appDir}`);
    } else {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  console.log(JSON.stringify(checks, null, 2));

  if (checks.some((check) => !check.ok)) {
    process.exitCode = 1;
  }
}

await main();
