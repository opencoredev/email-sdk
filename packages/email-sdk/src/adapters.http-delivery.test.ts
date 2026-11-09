import { describe, expect, test } from "bun:test";
import { brevo } from "./brevo.js";
import { cloudflare } from "./cloudflare.js";
import { EmailAdapterError } from "./errors.js";
import { graph } from "./graph.js";
import { helo } from "./helo.js";
import { iterable } from "./iterable.js";
import { jetemail } from "./jetemail.js";
import { lettermint } from "./lettermint.js";
import { lettr } from "./lettr.js";
import { loops } from "./loops.js";
import { mailchimp } from "./mailchimp.js";
import { mailersend } from "./mailersend.js";
import { mailgun } from "./mailgun.js";
import { mailpace } from "./mailpace.js";
import { mailtrap } from "./mailtrap.js";
import { plunk } from "./plunk.js";
import { postmark } from "./postmark.js";
import { primitive } from "./primitive.js";
import { resend } from "./resend.js";
import { scaleway } from "./scaleway.js";
import { sendgrid } from "./sendgrid.js";
import { sendheron } from "./sendheron.js";
import { sequenzy } from "./sequenzy.js";
import { ses } from "./ses.js";
import { sparkpost } from "./sparkpost.js";
import type { EmailAdapter, EmailMessage } from "./types.js";
import { unosend } from "./unosend.js";
import { SUPPORTED_MESSAGE_FIELDS } from "./utils.js";
import { zeptomail } from "./zeptomail.js";
import { context } from "../test-support/adapter-fixtures.js";
import { rejectionOf } from "../test-support/assertions.js";
import { stubFetch } from "../test-support/fetch.js";

type Delivery = EmailAdapterError["delivery"];

type HttpAdapterCase = {
  create: (fetch: typeof fetch) => EmailAdapter;
  /** Statuses where the adapter documents its own classification instead of the shared default. */
  overrides?: Partial<Record<number, Delivery>>;
};

// Every status here is a definite rejection: the provider refused the request before sending.
const DEFINITE_REJECTIONS = [400, 401, 403, 404, 413, 422];

// The outcome of these is ambiguous, so the shared default keeps them unknown.
const AMBIGUOUS_FAILURES = [408, 409, 429, 500, 502, 503, 504];

const message: EmailMessage = {
  from: "Acme <hello@example.com>",
  to: "ada@example.com",
  subject: "Welcome",
  text: "Hello",
  html: "<p>Hello</p>",
};

const HTTP_ADAPTERS = {
  brevo: { create: (fetch) => brevo({ apiKey: "key", fetch }) },
  cloudflare: {
    create: (fetch) => cloudflare({ apiToken: "token", accountId: "account", fetch }),
  },
  graph: {
    create: (fetch) => graph({ getAccessToken: () => "token", fetch }),
    // Graph and Lettr treat every 4xx as a refusal before sending.
    overrides: { 408: "not_sent", 409: "not_sent", 429: "not_sent" },
  },
  helo: {
    create: (fetch) => helo({ apiKey: "key", fetch }),
    // Helo documents a 429 as a refusal before sending.
    overrides: { 429: "not_sent" },
  },
  iterable: { create: (fetch) => iterable({ apiKey: "key", campaignId: 1, fetch }) },
  jetemail: { create: (fetch) => jetemail({ apiKey: "key", fetch }) },
  lettermint: { create: (fetch) => lettermint({ apiToken: "token", fetch }) },
  lettr: {
    create: (fetch) => lettr({ apiKey: "key", fetch }),
    overrides: { 408: "not_sent", 409: "not_sent", 429: "not_sent" },
  },
  loops: { create: (fetch) => loops({ apiKey: "key", transactionalId: "tx", fetch }) },
  mailchimp: { create: (fetch) => mailchimp({ apiKey: "key", fetch }) },
  mailersend: { create: (fetch) => mailersend({ apiKey: "key", fetch }) },
  mailgun: { create: (fetch) => mailgun({ apiKey: "key", domain: "example.com", fetch }) },
  mailpace: { create: (fetch) => mailpace({ apiKey: "key", fetch }) },
  mailtrap: { create: (fetch) => mailtrap({ apiKey: "key", fetch }) },
  plunk: { create: (fetch) => plunk({ apiKey: "key", fetch }) },
  postmark: { create: (fetch) => postmark({ serverToken: "token", fetch }) },
  primitive: { create: (fetch) => primitive({ apiKey: "key", fetch }) },
  resend: { create: (fetch) => resend({ apiKey: "key", fetch }) },
  scaleway: {
    create: (fetch) => scaleway({ secretKey: "secret", projectId: "project", fetch }),
  },
  sendgrid: { create: (fetch) => sendgrid({ apiKey: "key", fetch }) },
  sendheron: {
    create: (fetch) => sendheron({ apiKey: "key", fetch }),
    // SendHeron rejects every 4xx except 409 before sending, and records a 503 as a refusal.
    overrides: { 408: "not_sent", 429: "not_sent", 503: "not_sent" },
  },
  sequenzy: { create: (fetch) => sequenzy({ apiKey: "key", fetch }) },
  ses: {
    create: (fetch) =>
      ses({ accessKeyId: "access", secretAccessKey: "secret", region: "us-east-1", fetch }),
  },
  sparkpost: { create: (fetch) => sparkpost({ apiKey: "key", fetch }) },
  unosend: { create: (fetch) => unosend({ apiKey: "key", fetch }) },
  zeptomail: { create: (fetch) => zeptomail({ token: "token", fetch }) },
} satisfies Record<Exclude<keyof typeof SUPPORTED_MESSAGE_FIELDS, "smtp">, HttpAdapterCase>;

function respondWith(status: number) {
  return stubFetch(
    async () =>
      new Response(JSON.stringify({ message: "rejected" }), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

async function deliveryFor(adapterCase: HttpAdapterCase, status: number) {
  const adapter = adapterCase.create(respondWith(status));
  const error = await rejectionOf(adapter.send(message, context), EmailAdapterError);
  expect(error.status).toBe(status);

  return error.delivery;
}

describe("HTTP adapter delivery classification", () => {
  test("covers every built-in adapter except SMTP", () => {
    const builtIn = Object.keys(SUPPORTED_MESSAGE_FIELDS).filter((name) => name !== "smtp");
    expect(Object.keys(HTTP_ADAPTERS).toSorted()).toEqual(builtIn.toSorted());
  });

  for (const [name, adapterCase] of Object.entries<HttpAdapterCase>(HTTP_ADAPTERS)) {
    test(`${name} maps definite 4xx rejections to not_sent`, async () => {
      for (const status of DEFINITE_REJECTIONS) {
        expect({ status, delivery: await deliveryFor(adapterCase, status) }).toEqual({
          status,
          delivery: "not_sent",
        });
      }
    });

    test(`${name} keeps timeouts, rate limits, conflicts, and 5xx unknown`, async () => {
      for (const status of AMBIGUOUS_FAILURES) {
        expect({ status, delivery: await deliveryFor(adapterCase, status) }).toEqual({
          status,
          delivery: adapterCase.overrides?.[status] ?? "unknown",
        });
      }
    });
  }
});
