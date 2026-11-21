import { describe, expect, test } from "bun:test";

import { brevo } from "./brevo.js";
import { cloudflare } from "./cloudflare.js";
import { iterable } from "./iterable.js";
import { loops } from "./loops.js";
import { mailchimp } from "./mailchimp.js";
import { mailersend } from "./mailersend.js";
import { mailgun } from "./mailgun.js";
import { mailpace } from "./mailpace.js";
import { mailtrap } from "./mailtrap.js";
import { plunk } from "./plunk.js";
import { scaleway } from "./scaleway.js";
import { sendgrid } from "./sendgrid.js";
import { sequenzy } from "./sequenzy.js";
import { sparkpost } from "./sparkpost.js";
import { unosend } from "./unosend.js";
import { zeptomail } from "./zeptomail.js";
import type { EmailAdapter, EmailMessage } from "./types.js";
import { context, formCapture, jsonCapture } from "../test-support/adapter-fixtures.js";
import type { JsonValue } from "../test-support/json.js";

const message: EmailMessage = {
  from: "hello@example.com",
  to: "ada@example.com",
  subject: "Hi",
  text: "Hello",
};

/** The parts of a captured request a credential can appear in. */
type CapturedCall = { headers: Headers; key?: string };

type RotationCase = {
  name: string;
  /** Builds the adapter with a credential read through a getter, like a secret manager client. */
  build: (credential: () => string, fetch: typeof fetch) => EmailAdapter;
  /** Where the credential shows up in the request. */
  read: (call: CapturedCall) => string | null | undefined;
  expected: (key: string) => string;
  response?: JsonValue;
  responseInit?: ResponseInit;
  /** Mailgun posts multipart form data instead of JSON. */
  form?: true;
};

const header = (name: string) => (call: CapturedCall) => call.headers.get(name);

const bearer = (key: string) => `Bearer ${key}`;

const raw = (key: string) => key;

const cases: RotationCase[] = [
  {
    name: "sendgrid",
    build: (key, fetch) =>
      sendgrid({
        get apiKey() {
          return key();
        },
        fetch,
      }),
    read: header("authorization"),
    expected: bearer,
    responseInit: { headers: { "x-message-id": "sg_1" } },
  },
  {
    name: "brevo",
    build: (key, fetch) =>
      brevo({
        get apiKey() {
          return key();
        },
        fetch,
      }),
    read: header("api-key"),
    expected: raw,
    response: { messageId: "b_1" },
  },
  {
    name: "mailersend",
    build: (key, fetch) =>
      mailersend({
        get apiKey() {
          return key();
        },
        fetch,
      }),
    read: header("authorization"),
    expected: bearer,
  },
  {
    name: "cloudflare",
    build: (key, fetch) =>
      cloudflare({
        get apiToken() {
          return key();
        },
        accountId: "acct",
        fetch,
      }),
    read: header("authorization"),
    expected: bearer,
    response: { success: true, result: { delivered: ["ada@example.com"] } },
  },
  {
    name: "iterable",
    build: (key, fetch) =>
      iterable({
        get apiKey() {
          return key();
        },
        campaignId: 1,
        fetch,
      }),
    read: header("api-key"),
    expected: raw,
    response: { code: "Success" },
  },
  {
    name: "loops",
    build: (key, fetch) =>
      loops({
        get apiKey() {
          return key();
        },
        transactionalId: "t",
        fetch,
      }),
    read: header("authorization"),
    expected: bearer,
    response: { success: true },
  },
  {
    name: "mailpace",
    build: (key, fetch) =>
      mailpace({
        get apiKey() {
          return key();
        },
        fetch,
      }),
    read: header("mailpace-server-token"),
    expected: raw,
    response: { id: 1, status: "queued" },
  },
  {
    name: "plunk",
    build: (key, fetch) =>
      plunk({
        get apiKey() {
          return key();
        },
        fetch,
      }),
    read: header("authorization"),
    expected: bearer,
    response: { success: true, emails: [] },
  },
  {
    name: "sparkpost",
    build: (key, fetch) =>
      sparkpost({
        get apiKey() {
          return key();
        },
        fetch,
      }),
    read: header("authorization"),
    expected: raw,
    response: { results: { id: "sp_1" } },
  },
  {
    name: "scaleway",
    build: (key, fetch) =>
      scaleway({
        get secretKey() {
          return key();
        },
        projectId: "p",
        fetch,
      }),
    read: header("x-auth-token"),
    expected: raw,
    response: { emails: [{ id: "sc_1" }] },
  },
  {
    name: "mailtrap",
    build: (key, fetch) =>
      mailtrap({
        get apiKey() {
          return key();
        },
        fetch,
      }),
    read: header("api-token"),
    expected: raw,
    response: { success: true, message_ids: ["mt_1"] },
  },
  {
    name: "unosend",
    build: (key, fetch) =>
      unosend({
        get apiKey() {
          return key();
        },
        fetch,
      }),
    read: header("authorization"),
    expected: bearer,
    response: { success: true, data: { id: "u_1" } },
  },
  {
    name: "sequenzy",
    build: (key, fetch) =>
      sequenzy({
        get apiKey() {
          return key();
        },
        fetch,
      }),
    read: header("authorization"),
    expected: bearer,
    response: { success: true },
  },
  {
    name: "zeptomail",
    build: (key, fetch) =>
      zeptomail({
        get token() {
          return key();
        },
        fetch,
      }),
    read: header("authorization"),
    expected: (key) => `Zoho-enczapikey ${key}`,
    response: { data: [{ code: "EM_104" }], request_id: "z_1" },
  },
  {
    name: "mailchimp",
    build: (key, fetch) =>
      mailchimp({
        get apiKey() {
          return key();
        },
        fetch,
      }),
    read: (call) => call.key,
    expected: raw,
    response: [{ _id: "mc_1", email: "ada@example.com", status: "sent" }],
  },
  {
    name: "mailgun",
    build: (key, fetch) =>
      mailgun({
        get apiKey() {
          return key();
        },
        domain: "mg.example.com",
        fetch,
      }),
    read: header("authorization"),
    expected: (key) => `Basic ${btoa(`api:${key}`)}`,
    response: { id: "<mg_1>" },
    form: true,
  },
];

describe("adapters read credentials on every send", () => {
  test.each(cases.map((entry) => [entry.name, entry] as const))(
    "%s sends a rotated credential without rebuilding the client",
    async (_name, entry) => {
      const json = jsonCapture(entry.response ?? {}, entry.responseInit);
      const form = formCapture(entry.response ?? {});
      let current = "key-1";
      const adapter = entry.build(() => current, entry.form ? form.fetch : json.fetch);

      await adapter.send(message, context);
      current = "key-2";
      await adapter.send(message, context);

      const calls: CapturedCall[] = entry.form
        ? form.calls
        : json.calls.map((call) => ({ headers: call.headers, key: call.json.key }));

      expect(calls).toHaveLength(2);
      expect(calls.map((call) => entry.read(call))).toEqual([
        entry.expected("key-1"),
        entry.expected("key-2"),
      ]);
    },
  );
});
