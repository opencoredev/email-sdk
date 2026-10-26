import { parseBrevoInbound, type BrevoInboundOptions } from "./inbound/brevo.js";
import { fetchGraphInboundEmail, graphValidationResponse, parseGraphNotifications, type GraphInboundApiOptions } from "./inbound/graph.js";
import { parseJetEmailInbound, verifyJetEmailInbound } from "./inbound/jetemail.js";
import { parseLettermintInbound, verifyLettermintInbound } from "./inbound/lettermint.js";
import { isMandrillWebhookTest, parseMandrillInbound, verifyMandrillInbound } from "./inbound/mailchimp.js";
import { isMailerSendRouteTest, parseMailerSendInbound, verifyMailerSendInbound } from "./inbound/mailersend.js";
import { parseMailgunInbound, verifyMailgunInbound } from "./inbound/mailgun.js";
import { parseMailPaceInbound, verifyMailPaceInbound } from "./inbound/mailpace.js";
import { parsePostmarkInbound } from "./inbound/postmark.js";
import { parsePrimitiveInbound, verifyPrimitiveInbound, type PrimitiveInboundOptions } from "./inbound/primitive.js";
import { fetchResendInboundEmail, parseResendInbound, verifyResendInbound, type ResendInboundApiOptions } from "./inbound/resend.js";
import { parseSendGridInbound, verifySendGridInbound } from "./inbound/sendgrid.js";
import {
  assertSesTopicConfigured,
  confirmSnsSubscription,
  parseSesInbound,
  parseSnsMessage,
  verifySnsMessage,
  type SesInboundOptions,
} from "./inbound/ses.js";
import {
  type InboundBasicAuthOptions,
  type InboundFetchOptions,
  assertVerified,
  verifyBasicAuth,
  verifyBearerToken,
} from "./inbound/shared.js";
import { parseLettrInbound, parseSparkPostInbound, verifySparkPostInbound } from "./inbound/sparkpost.js";
import {
  type InboundClockOptions,
  type InboundEmail,
  InboundError,
  type InboundProvider,
  type InboundRequestPayload,
  type InboundVerification,
} from "./inbound/types.js";

export {
  InboundError,
  InboundHeaders,
} from "./inbound/types.js";

export type {
  InboundAddress,
  InboundAttachment,
  InboundClockOptions,
  InboundEmail,
  InboundEnvelope,
  InboundErrorReason,
  InboundFormFields,
  InboundHeader,
  InboundHeadersInit,
  InboundProvider,
  InboundRawPayload,
  InboundRequestPayload,
  InboundSecurity,
  InboundSignatureOptions,
  InboundTokenOptions,
  InboundVerdict,
  InboundVerification,
} from "./inbound/types.js";

export { verifyBasicAuth, verifyBearerToken } from "./inbound/shared.js";

export type { InboundBasicAuthOptions, InboundFetchOptions } from "./inbound/shared.js";

export { decodeEncodedWords, parseAddressList, parseMimeMessage } from "./inbound/mime.js";

export type { ParsedMimeMessage } from "./inbound/mime.js";

export { emailFromMime } from "./inbound/normalize.js";

export type { MimeEmailOptions } from "./inbound/normalize.js";

export { parseBrevoInbound } from "./inbound/brevo.js";

export type { BrevoInboundOptions } from "./inbound/brevo.js";

export { parseCloudflareInbound } from "./inbound/cloudflare.js";

export type { CloudflareEmailMessage } from "./inbound/cloudflare.js";

export { fetchGraphInboundEmail, graphValidationResponse, parseGraphNotifications } from "./inbound/graph.js";

export type { GraphInboundApiOptions, GraphMessageNotification, GraphNotificationOptions } from "./inbound/graph.js";

export { parseJetEmailInbound, verifyJetEmailInbound } from "./inbound/jetemail.js";

export { parseLettermintInbound, verifyLettermintInbound } from "./inbound/lettermint.js";

export { isMandrillWebhookTest, parseMandrillInbound, verifyMandrillInbound } from "./inbound/mailchimp.js";

export type { MandrillInboundVerificationOptions } from "./inbound/mailchimp.js";

export { isMailerSendRouteTest, parseMailerSendInbound, verifyMailerSendInbound } from "./inbound/mailersend.js";

export { fetchMailgunStoredEmail, parseMailgunInbound, verifyMailgunInbound } from "./inbound/mailgun.js";

export type { MailgunInboundApiOptions } from "./inbound/mailgun.js";

export { parseMailPaceInbound, verifyMailPaceInbound } from "./inbound/mailpace.js";

export type { MailPaceInboundVerificationOptions } from "./inbound/mailpace.js";

export { fetchMailtrapInboundEmail, verifyMailtrapInbound } from "./inbound/mailtrap.js";

export type { MailtrapInboundApiOptions } from "./inbound/mailtrap.js";

export { fetchPostmarkInboundEmail, parsePostmarkInbound } from "./inbound/postmark.js";

export type { PostmarkInboundApiOptions } from "./inbound/postmark.js";

export { parsePrimitiveInbound, verifyPrimitiveInbound } from "./inbound/primitive.js";

export type { PrimitiveInboundOptions } from "./inbound/primitive.js";

export { fetchResendInboundEmail, parseResendInbound, verifyResendInbound } from "./inbound/resend.js";

export type { ResendInboundApiOptions } from "./inbound/resend.js";

export { parseSendGridInbound, verifySendGridInbound } from "./inbound/sendgrid.js";

export type { SendGridInboundVerificationOptions } from "./inbound/sendgrid.js";

export {
  certificatePublicKey,
  confirmSnsSubscription,
  fetchSesInboundFromS3,
  isTrustedSnsUrl,
  parseSesInbound,
  parseSesNotification,
  parseSnsMessage,
  sesEmailFromNotification,
  verifySnsMessage,
} from "./inbound/ses.js";

export type {
  SesInboundOptions,
  SesInboundS3Options,
  SesReceivedNotification,
  SesS3Location,
  SnsCertificateCacheEntry,
  SnsMessage,
  SnsVerificationOptions,
} from "./inbound/ses.js";

export { parseLettrInbound, parseSparkPostInbound, verifySparkPostInbound } from "./inbound/sparkpost.js";

/** How an unsigned provider's endpoint is protected. `none` must be chosen explicitly. */
export type InboundEndpointAuth =
  | { basic: InboundBasicAuthOptions }
  | { bearer: string | readonly string[] }
  | { none: true };

type Secret = string | readonly string[];

/** Per-provider settings for `handleInbound`. Each signed provider requires its secret. */
export type InboundHandlerConfig = InboundClockOptions & InboundFetchOptions & (
  | { provider: "resend"; secret: Secret; api?: ResendInboundApiOptions }
  | { provider: "postmark"; auth: InboundEndpointAuth }
  | { provider: "mailgun"; secret: Secret }
  | { provider: "sendgrid"; publicKey: Secret }
  | { provider: "sendgrid"; auth: InboundEndpointAuth }
  | ({ provider: "ses"; confirmSubscription?: boolean } & SesInboundOptions)
  | { provider: "graph"; clientState: string; api: GraphInboundApiOptions }
  | { provider: "mailchimp"; secret: Secret; url?: string }
  | { provider: "sparkpost"; secret: Secret }
  | { provider: "lettr"; secret: Secret }
  | { provider: "mailersend"; secret: Secret }
  | { provider: "mailpace"; publicKey: Secret }
  | { provider: "lettermint"; secret: Secret }
  | ({ provider: "primitive"; secret: Secret } & Pick<PrimitiveInboundOptions, "downloadOrigins">)
  | { provider: "jetemail"; secret: Secret }
  | ({ provider: "brevo"; auth: InboundEndpointAuth } & BrevoInboundOptions)
);

/** What `handleInbound` produced: received emails, or a handshake response to return as-is. */
export type InboundHandlerResult =
  | { type: "emails"; emails: InboundEmail[] }
  | { type: "handshake"; response: Response };

function acknowledged(): Response {
  return new Response(null, { status: 200 });
}

function endpointAuth(payload: InboundRequestPayload, auth: InboundEndpointAuth): InboundVerification {
  if ("none" in auth) return auth.none === true ? { ok: true } : { ok: false, reason: "secret_missing" };

  if ("basic" in auth) return verifyBasicAuth(payload.headers, auth.basic);

  return verifyBearerToken(payload.headers, auth.bearer);
}

/**
 * Parse an inbound payload without verifying it. Use the matching `verify*Inbound` function
 * first, or `handleInbound`, which verifies before parsing. SES verifies the SNS signature
 * unless `skipVerification` is set in its options.
 */
export async function parseInbound(
  provider: Exclude<InboundProvider, "cloudflare" | "graph" | "mailtrap">,
  payload: InboundRequestPayload,
  options: InboundFetchOptions & SesInboundOptions & BrevoInboundOptions & PrimitiveInboundOptions = {},
): Promise<InboundEmail[]> {
  switch (provider) {
    case "resend":
      return [parseResendInbound(payload)];
    case "postmark":
      return [parsePostmarkInbound(payload)];
    case "mailgun":
      return [await parseMailgunInbound(payload)];
    case "sendgrid":
      return [parseSendGridInbound(payload)];
    case "ses":
      return [await parseSesInbound(payload, options)];
    case "mailchimp":
      return parseMandrillInbound(payload);
    case "sparkpost":
      return parseSparkPostInbound(payload);
    case "lettr":
      return parseLettrInbound(payload);
    case "mailersend":
      return [parseMailerSendInbound(payload)];
    case "mailpace":
      return [parseMailPaceInbound(payload)];
    case "lettermint":
      return [parseLettermintInbound(payload, options)];
    case "primitive":
      return [await parsePrimitiveInbound(payload, options)];
    case "jetemail":
      return [parseJetEmailInbound(payload)];
    case "brevo":
      return parseBrevoInbound(payload, options);
    default:
      throw new InboundError(`Unsupported inbound provider: ${String(provider)}`, { reason: "unsupported", provider });
  }
}

/**
 * Verify and parse an inbound request in a web-standard route handler (Next.js, Hono,
 * Workers, Bun, Convex HTTP actions). Throws `InboundError` when verification fails; map
 * `signature_*` and `timestamp_expired` reasons to 401 and `payload_invalid` to 400.
 */
export async function handleInbound(request: Request, config: InboundHandlerConfig): Promise<InboundHandlerResult> {
  const fetchOptions = { fetch: config.fetch, signal: config.signal };
  const clock = { now: config.now, toleranceSeconds: config.toleranceSeconds };

  if (config.provider === "graph") {
    // Refuse to confirm a subscription this handler could never verify notifications for.
    if (!config.clientState) {
      throw new InboundError("Graph notifications need the subscription clientState.", { reason: "secret_missing", provider: "graph" });
    }

    const validation = graphValidationResponse(request.url);

    if (validation) return { type: "handshake", response: validation };
  }

  // Mandrill checks a new webhook URL with a HEAD request before it falls back to a test POST.
  if (config.provider === "mailchimp" && request.method === "HEAD") return { type: "handshake", response: acknowledged() };

  // Copy headers before reading the body: Bun drops a FormData Content-Type from headers
  // first accessed after the body is consumed.
  const headers = new Headers(request.headers);
  const payload: InboundRequestPayload = { body: new Uint8Array(await request.arrayBuffer()), headers, url: request.url };

  switch (config.provider) {
    case "resend": {
      assertVerified("resend", await verifyResendInbound(payload, { ...clock, secret: config.secret }));
      const email = parseResendInbound(payload);

      if (!config.api || !email.id) return { type: "emails", emails: [email] };

      return { type: "emails", emails: [await fetchResendInboundEmail(email.id, { ...fetchOptions, ...config.api })] };
    }

    case "postmark":
      assertVerified("postmark", endpointAuth(payload, config.auth));

      return { type: "emails", emails: [parsePostmarkInbound(payload)] };
    case "mailgun":
      assertVerified("mailgun", await verifyMailgunInbound(payload, { ...clock, secret: config.secret }));

      return { type: "emails", emails: [await parseMailgunInbound(payload)] };
    case "sendgrid":
      assertVerified("sendgrid", "publicKey" in config
        ? await verifySendGridInbound(payload, { ...clock, publicKey: config.publicKey })
        : endpointAuth(payload, config.auth));

      return { type: "emails", emails: [parseSendGridInbound(payload)] };
    case "ses": {
      assertSesTopicConfigured(config);

      const message = parseSnsMessage(payload.body);
      assertVerified("ses", await verifySnsMessage(message, { ...config, ...fetchOptions }));

      if (message.Type === "SubscriptionConfirmation") {
        if (config.confirmSubscription !== false) await confirmSnsSubscription(message, fetchOptions);

        return { type: "handshake", response: acknowledged() };
      }

      if (message.Type === "UnsubscribeConfirmation") return { type: "handshake", response: acknowledged() };

      return { type: "emails", emails: [await parseSesInbound(payload, { ...config, ...fetchOptions, skipVerification: true })] };
    }

    case "graph": {
      const notifications = parseGraphNotifications(payload, { clientState: config.clientState });
      const created = notifications.filter(notification => notification.changeType === "created");

      return {
        type: "emails",
        emails: await Promise.all(created.map(notification => fetchGraphInboundEmail(notification.resource, { ...fetchOptions, ...config.api }))),
      };
    }

    case "mailchimp": {
      const url = config.url ?? request.url;
      const check = await verifyMandrillInbound(payload, { secret: config.secret, url });

      if (!check.ok && await isMandrillWebhookTest(payload, { url })) return { type: "handshake", response: acknowledged() };

      assertVerified("mailchimp", check);

      return { type: "emails", emails: await parseMandrillInbound(payload) };
    }

    case "sparkpost":
      assertVerified("sparkpost", verifySparkPostInbound(payload, { secret: config.secret }));

      return { type: "emails", emails: parseSparkPostInbound(payload) };
    case "lettr":
      assertVerified("lettr", verifySparkPostInbound(payload, { secret: config.secret }));

      return { type: "emails", emails: parseLettrInbound(payload) };
    case "mailersend":
      if (await isMailerSendRouteTest(payload)) return { type: "handshake", response: acknowledged() };

      assertVerified("mailersend", await verifyMailerSendInbound(payload, { secret: config.secret }));

      return { type: "emails", emails: [parseMailerSendInbound(payload)] };
    case "mailpace":
      assertVerified("mailpace", await verifyMailPaceInbound(payload, { publicKey: config.publicKey }));

      return { type: "emails", emails: [parseMailPaceInbound(payload)] };
    case "lettermint":
      assertVerified("lettermint", await verifyLettermintInbound(payload, { ...clock, secret: config.secret }));

      return { type: "emails", emails: [parseLettermintInbound(payload, fetchOptions)] };
    case "primitive":
      assertVerified("primitive", await verifyPrimitiveInbound(payload, { ...clock, secret: config.secret }));

      return { type: "emails", emails: [await parsePrimitiveInbound(payload, { ...fetchOptions, downloadOrigins: config.downloadOrigins })] };
    case "jetemail":
      assertVerified("jetemail", await verifyJetEmailInbound(payload, { ...clock, secret: config.secret }));

      return { type: "emails", emails: [parseJetEmailInbound(payload)] };
    case "brevo":
      assertVerified("brevo", endpointAuth(payload, config.auth));

      return { type: "emails", emails: parseBrevoInbound(payload, { ...fetchOptions, apiKey: config.apiKey, baseUrl: config.baseUrl }) };
  }
}
