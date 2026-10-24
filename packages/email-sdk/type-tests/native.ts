import { brevo } from "../src/brevo.js";
import { createEmailClient } from "../src/index.js";
import type {
  AdapterNativeOptions,
  EmailAdapter,
  EmailMessage,
  EmailNativeOptions,
  EmailClient,
  EmailNativeOptionsMap,
  EmailNativePassthrough,
  EmailBeforeSendEvent,
  EmailBeforeSendResult,
  EmailPlugin,
  EmailSendItem,
  EmailSendMiddleware,
  EmailSendOptions,
} from "../src/index.js";
import { loops } from "../src/loops.js";
import { mailersend } from "../src/mailersend.js";
import { mailgun } from "../src/mailgun.js";
import { postmark, type PostmarkNativeOptions } from "../src/postmark.js";
import { resend, type ResendNativeOptions } from "../src/resend.js";
import { sendgrid } from "../src/sendgrid.js";
import { ses } from "../src/ses.js";
import { smtp } from "../src/smtp.js";
import { memoryAdapter } from "../src/testing.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

function assertType<T extends true>(value: T) {
  return value;
}

const message: EmailMessage = {
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Hello",
  text: "Hello",
};

const resendAdapter = resend({ apiKey: "re_test" });

const postmarkAdapter = postmark({ serverToken: "pm_test" });

assertType<Equal<AdapterNativeOptions<typeof resendAdapter>, ResendNativeOptions>>(true);

assertType<Equal<AdapterNativeOptions<typeof postmarkAdapter>, PostmarkNativeOptions>>(true);

const client = createEmailClient({
  adapters: [
    resendAdapter,
    postmarkAdapter,
    sendgrid({ apiKey: "sg" }),
    ses({ accessKeyId: "a", secretAccessKey: "s", region: "us-east-1" }),
    mailgun({ apiKey: "mg", domain: "mg.example.com" }),
    brevo({ apiKey: "br" }),
    loops({ apiKey: "lp", transactionalId: "tx" }),
    mailersend({ apiKey: "ms" }),
    smtp({ name: "backup", host: "smtp.example.com" }),
  ],
});

type ClientNative = NonNullable<Parameters<typeof client.send>[1]>["native"];

// Adapters without declared native options (smtp here) get no key.
assertType<
  Equal<
    keyof NonNullable<ClientNative>,
    "resend" | "postmark" | "sendgrid" | "ses" | "mailgun" | "brevo" | "loops" | "mailersend"
  >
>(true);

// Every JSON adapter carries the typed passthrough.
assertType<Equal<NonNullable<NonNullable<ClientNative>["mailersend"]>, EmailNativePassthrough>>(true);

client.send(message, {
  native: {
    resend: { template: { id: "welcome", variables: { name: "Ada", count: 2 } }, topicId: "t" },
    postmark: { template: { alias: "welcome", model: { name: "Ada" } }, trackLinks: "HtmlOnly" },
    sendgrid: { templateId: "d-123", dynamicTemplateData: { name: "Ada" }, sandboxMode: true },
    ses: { template: { name: "Welcome", data: { name: "Ada" } }, configurationSetName: "cs" },
    mailgun: { template: { name: "welcome" }, tracking: "htmlonly", fields: { "o:dkim": "yes" } },
    brevo: { templateId: 7, params: { name: "Ada" } },
    loops: { transactionalId: "tx_2", dataVariables: { name: "Ada" } },
    mailersend: { body: { template_id: "abc" }, headers: { "X-Trace": "1" } },
  },
});

// Unified sends without native options stay valid.
client.send(message);

client.send(message, { adapter: "backup", fallback: { adapters: ["resend"] } });

client.sendMany([{ message, options: { native: { postmark: { messageStream: "broadcast" } } } }], {
  native: { postmark: { trackOpens: true } },
});

client.withAdapter("resend").send(message, { native: { resend: { topicId: "t" } } });

// @ts-expect-error unknown adapter keys are rejected
client.send(message, { native: { resnd: {} } });

// @ts-expect-error adapters without native options cannot receive them
client.send(message, { native: { backup: {} } });

// @ts-expect-error one provider's options do not fit another provider's key
client.send(message, { native: { resend: { messageStream: "outbound" } } });

// @ts-expect-error Postmark templates take an id or an alias, not both
client.send(message, { native: { postmark: { template: { id: 1, alias: "welcome" } } } });

// @ts-expect-error Postmark trackLinks is a closed set
client.send(message, { native: { postmark: { trackLinks: "Always" } } });

// @ts-expect-error Brevo template IDs are numbers
client.send(message, { native: { brevo: { templateId: "7" } } });

// @ts-expect-error Loops data variables are strings or numbers
client.send(message, { native: { loops: { dataVariables: { vip: true } } } });

// @ts-expect-error SES templates take a name or an ARN, not both
client.send(message, { native: { ses: { template: { name: "a", arn: "b" } } } });

// @ts-expect-error per-item batch options are checked too
client.sendMany([{ message, options: { native: { sendgrid: { sandboxMode: "yes" } } } }]);

// A client without native-aware adapters accepts no native keys.
const plain = createEmailClient({ adapters: [smtp({ name: "relay", host: "smtp.example.com" })] });

// @ts-expect-error SMTP adapters declare no native options
plain.send(message, { native: { relay: {} } });

// Adapters with a non-literal name make an untyped client, which accepts any entry.
createEmailClient({ adapters: [memoryAdapter()] }).send(message, { native: { memory: {} } });

assertType<Equal<EmailNativeOptions<readonly EmailAdapter[]>, EmailNativeOptionsMap>>(true);

// Typed clients stay assignable to the untyped EmailClient, as they were before native existed.
export const untypedClient: EmailClient = client;

export const untypedPlain: EmailClient = plain;

// Custom adapters opt in by declaring their native options type.
type AcmeNative = { priority?: "high" | "low" };

const acme: EmailAdapter<"acme", unknown, unknown, AcmeNative> = {
  name: "acme",
  capabilities: {
    repeatedHeaders: true,
    idempotency: "none",
    scheduling: false,
    personalized: "expanded",
  },
  send(_message, context) {
    const priority: "high" | "low" | undefined = context.native?.priority;
    void priority;

    return { adapter: "acme" };
  },
};

const custom = createEmailClient({ adapters: [acme, resendAdapter] });

custom.send(message, { native: { acme: { priority: "high" }, resend: { topicId: "t" } } });

// @ts-expect-error custom native options are checked
custom.send(message, { native: { acme: { priority: "urgent" } } });

// Options typed before native existed keep flowing into typed clients.
const legacyOptions: EmailSendOptions<"resend" | "postmark"> = { adapter: "resend", idempotencyKey: "k" };

client.send(message, legacyOptions);

const resendOnly: EmailSendOptions<"resend"> = { adapter: "resend" };

custom.send(message, resendOnly);

// @ts-expect-error plain EmailSendOptions cannot carry untyped native options
export const untypedNative: EmailSendOptions = { native: { resend: {} } };

// Middleware, hooks, and helpers annotated with the exported option types before native existed
// still compile. Core hands them options that may carry `native`, and that must stay assignable
// to the plain `EmailSendOptions` shape.
function normalize(options: EmailSendOptions | undefined): EmailSendOptions | undefined {
  return options && { ...options, idempotencyKey: options.idempotencyKey ?? "generated" };
}

export const legacyMiddleware: EmailSendMiddleware = {
  beforeSend(event) {
    return { options: normalize(event.options) };
  },
};

const legacyBeforeSend = (event: {
  message: EmailMessage;
  options?: EmailSendOptions;
}): EmailBeforeSendResult => ({ message: event.message, options: event.options });

export const legacyArrowMiddleware: EmailSendMiddleware = { beforeSend: legacyBeforeSend };

const legacyEvent: EmailBeforeSendEvent = { message };

export const legacyEventOptions: EmailSendOptions | undefined = legacyEvent.options;

export const legacyPlugin: EmailPlugin = { id: "legacy", middleware: [legacyMiddleware] };

createEmailClient({ adapters: [resendAdapter], plugins: [legacyPlugin] });

// Helpers that forward plain options into an untyped or typed client keep compiling.
export function forwardSend(target: EmailClient, options?: EmailSendOptions) {
  return target.send(message, options);
}

export function readSendOptions(
  options: Parameters<EmailClient["send"]>[1],
): EmailSendOptions | undefined {
  return options;
}

const legacyItems: EmailSendItem[] = [{ message, options: { idempotencyKey: "k" } }];

export const forwardedMany = (target: EmailClient) => target.sendMany(legacyItems, legacyOptions);
