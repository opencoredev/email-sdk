/**
 * Per-send overhead of the SDK compared with building the provider payload by
 * hand and calling the same mock `fetch` directly.
 *
 *   EMAIL_SDK_TELEMETRY=0 bun bench/overhead.ts           # human table
 *   EMAIL_SDK_TELEMETRY=0 bun bench/overhead.ts --json    # machine-readable
 *
 * Single process, small fixed iteration counts, no network. Each case reports
 * the median of several rounds so one GC pause does not skew it.
 */
import { createEmailClient } from "../src/core.js";
import { postmark } from "../src/postmark.js";
import { resend } from "../src/resend.js";
import { sendgrid } from "../src/sendgrid.js";
import { ses } from "../src/ses.js";
import { disableTelemetry } from "../src/telemetry.js";
import type { EmailMessage } from "../src/types.js";

process.env.EMAIL_SDK_TELEMETRY = "0";

disableTelemetry();

const ROUNDS = 7;

const SES_SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

type Case = {
  name: string;
  iterations: number;
  sdk: () => Promise<void>;
  raw: () => Promise<void>;
};

type CaseResult = {
  name: string;
  sdkNs: number;
  rawNs: number;
  overheadNs: number;
};

const okJson = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "application/json" } });

let requestCount = 0;

const mockFetch: typeof fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    requestCount += 1;

    // Touch the request like a real client would, so both paths pay the same.
    void input;
    void init?.body;

    return okJson('{"id":"msg_123","MessageID":"msg_123","To":"b@example.com","MessageId":"msg_123"}');
  },
  { preconnect: globalThis.fetch.preconnect },
);

const message: EmailMessage = {
  from: "Acme <hello@example.com>",
  to: ["b@example.com"],
  subject: "Your receipt",
  html: "<p>Thanks for your order.</p>",
  text: "Thanks for your order.",
  headers: [{ name: "X-Entity-Ref", value: "order_42" }],
  tags: [{ name: "kind", value: "receipt" }],
};

const resendClient = createEmailClient({
  adapters: [resend({ apiKey: "re_test", fetch: mockFetch })],
  telemetry: false,
});

const postmarkClient = createEmailClient({
  adapters: [postmark({ serverToken: "pm_test", fetch: mockFetch })],
  telemetry: false,
});

const sendgridClient = createEmailClient({
  adapters: [sendgrid({ apiKey: "sg_test", fetch: mockFetch })],
  telemetry: false,
});

const sesClient = createEmailClient({
  adapters: [
    ses({
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: SES_SECRET,
      region: "us-east-1",
      fetch: mockFetch,
    }),
  ],
  telemetry: false,
});

const batchRecipients = Array.from({ length: 20 }, (_, index) => `user${index}@example.com`);

const batchItems = batchRecipients.map((to) => ({ message: { ...message, to: [to] } }));

async function rawResend(to = "b@example.com") {
  const response = await mockFetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer re_test", "Content-Type": "application/json" },
    body: JSON.stringify({
      from: message.from,
      to: [to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: { "X-Entity-Ref": "order_42" },
      tags: message.tags,
    }),
  });

  await response.json();
}

async function rawPostmark() {
  const response = await mockFetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": "pm_test",
    },
    body: JSON.stringify({
      From: message.from,
      To: "b@example.com",
      Subject: message.subject,
      HtmlBody: message.html,
      TextBody: message.text,
      Headers: [{ Name: "X-Entity-Ref", Value: "order_42" }],
      Tag: "kind:receipt",
    }),
  });

  await response.json();
}

async function rawSendgrid() {
  const response = await mockFetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: "Bearer sg_test", "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: "b@example.com" }], headers: { "X-Entity-Ref": "order_42" } }],
      from: { email: "hello@example.com", name: "Acme" },
      subject: message.subject,
      content: [
        { type: "text/plain", value: message.text },
        { type: "text/html", value: message.html },
      ],
      categories: ["receipt"],
    }),
  });

  await response.text();
}

const encoder = new TextEncoder();

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacRaw(key: BufferSource, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));
}

async function deriveSesKey(dateStamp: string) {
  let key = await hmacRaw(encoder.encode(`AWS4${SES_SECRET}`), dateStamp);
  key = await hmacRaw(key, "us-east-1");
  key = await hmacRaw(key, "ses");
  key = await hmacRaw(key, "aws4_request");

  return crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

let cachedSesKey: { dateStamp: string; key: Promise<CryptoKey> } | undefined;

// Same caching the SDK does: derive once per UTC day, reuse the imported key.
function cachedSesKeyFor(dateStamp: string) {
  if (cachedSesKey?.dateStamp !== dateStamp) {
    cachedSesKey = { dateStamp, key: deriveSesKey(dateStamp) };
  }

  return cachedSesKey.key;
}

// The least a caller must do by hand to reach SES v2: SigV4 over the JSON body.
async function rawSes(signingKey: (dateStamp: string) => Promise<CryptoKey>) {
  const body = JSON.stringify({
    FromEmailAddress: message.from,
    Destination: { ToAddresses: ["b@example.com"] },
    EmailTags: [{ Name: "kind", Value: "receipt" }],
    Content: {
      Simple: {
        Subject: { Data: message.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: message.text, Charset: "UTF-8" },
          Html: { Data: message.html, Charset: "UTF-8" },
        },
        Headers: [{ Name: "X-Entity-Ref", Value: "order_42" }],
      },
    },
  });

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = hex(await crypto.subtle.digest("SHA-256", encoder.encode(body)));
  const host = "email.us-east-1.amazonaws.com";
  const scope = `${dateStamp}/us-east-1/ses/aws4_request`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonical = [
    "POST",
    "/v2/email/outbound-emails",
    "",
    `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const toSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    hex(await crypto.subtle.digest("SHA-256", encoder.encode(canonical))),
  ].join("\n");

  const signature = hex(
    await crypto.subtle.sign("HMAC", await signingKey(dateStamp), encoder.encode(toSign)),
  );

  const response = await mockFetch(`https://${host}/v2/email/outbound-emails`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });

  await response.text();
}

const cases: Case[] = [
  {
    name: "resend send",
    iterations: 20_000,
    sdk: async () => {
      await resendClient.send(message);
    },
    raw: () => rawResend(),
  },
  {
    name: "postmark send",
    iterations: 20_000,
    sdk: async () => {
      await postmarkClient.send(message);
    },
    raw: rawPostmark,
  },
  {
    name: "sendgrid send",
    iterations: 20_000,
    sdk: async () => {
      await sendgridClient.send(message);
    },
    raw: rawSendgrid,
  },
  {
    name: "ses send (SigV4)",
    iterations: 4_000,
    sdk: async () => {
      await sesClient.send(message);
    },
    // Raw derives the signing key on every request, as a naive hand-rolled signer would.
    raw: () => rawSes(deriveSesKey),
  },
  {
    name: "ses send (raw caches key)",
    iterations: 4_000,
    sdk: async () => {
      await sesClient.send(message);
    },
    raw: () => rawSes(cachedSesKeyFor),
  },
  {
    name: "resend sendMany x20",
    iterations: 1_000,
    sdk: async () => {
      await resendClient.sendMany(batchItems);
    },
    raw: async () => {
      for (const to of batchRecipients) await rawResend(to);
    },
  },
  {
    name: "createEmailClient + resend()",
    iterations: 20_000,
    sdk: async () => {
      createEmailClient({
        adapters: [resend({ apiKey: "re_test", fetch: mockFetch })],
        telemetry: false,
      });
    },
    raw: async () => {},
  },
];

async function timeRound(run: () => Promise<void>, iterations: number) {
  const start = Bun.nanoseconds();

  for (let index = 0; index < iterations; index += 1) await run();

  return (Bun.nanoseconds() - start) / iterations;
}

function median(values: number[]) {
  const sorted = values.toSorted((left, right) => left - right);

  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function measure(benchCase: Case): Promise<CaseResult> {
  const warmup = Math.max(200, Math.floor(benchCase.iterations / 10));
  await timeRound(benchCase.sdk, warmup);
  await timeRound(benchCase.raw, warmup);

  const sdkRounds: number[] = [];
  const rawRounds: number[] = [];

  // Interleave so drift (thermal, other tenants) hits both sides equally.
  for (let round = 0; round < ROUNDS; round += 1) {
    sdkRounds.push(await timeRound(benchCase.sdk, benchCase.iterations));
    rawRounds.push(await timeRound(benchCase.raw, benchCase.iterations));
  }

  const sdkNs = median(sdkRounds);
  const rawNs = median(rawRounds);

  return { name: benchCase.name, sdkNs, rawNs, overheadNs: sdkNs - rawNs };
}

const startedAt = Bun.nanoseconds();

const results: CaseResult[] = [];

for (const benchCase of cases) results.push(await measure(benchCase));

const elapsedSeconds = (Bun.nanoseconds() - startedAt) / 1e9;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ results, elapsedSeconds, requestCount }, null, 2));
} else {
  const micros = (ns: number) => `${(ns / 1000).toFixed(2)} µs`;

  console.table(
    results.map((result) => ({
      case: result.name,
      sdk: micros(result.sdkNs),
      raw: micros(result.rawNs),
      overhead: micros(result.overheadNs),
    })),
  );
  console.log(`elapsed ${elapsedSeconds.toFixed(1)}s, ${requestCount} mock requests`);
}
