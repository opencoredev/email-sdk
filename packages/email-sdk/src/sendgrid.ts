import { firstString, jsonProvider } from "./http.js";
import {
  apiAddress,
  apiAddresses,
  commonHeadersObject,
  optionalApiAddresses,
  recipientVariableEntries,
  sendAtUnixSeconds,
  sendgridAttachments,
} from "./payloads.js";
import type {
  EmailMessage,
  EmailAdapter,
  EmailNativeObject,
  EmailNativePassthrough,
} from "./types.js";
import { arrayify, assertMaxItems, emailAddressOf, hasRecipientVariables } from "./utils.js";

export type SendGridAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

/**
 * Experimental. SendGrid-only send options, passed as `native: { sendgrid: { ... } }`.
 * https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
 */
export type SendGridNativeOptions = EmailNativePassthrough & {
  /**
   * Dynamic template ID (`d-...`). The template supplies the body, so the message's `html` and
   * `text` are not sent. Dynamic templates take their subject from the template.
   */
  templateId?: string;
  /**
   * Handlebars data for the dynamic template. With `sendPersonalized`, each recipient's
   * variables are merged over it in that recipient's personalization.
   */
  dynamicTemplateData?: EmailNativeObject;
  /** Unsubscribe group settings (`asm`). */
  asm?: { groupId: number; groupsToDisplay?: readonly number[] };
  ipPoolName?: string;
  batchId?: string;
  /** Validates the request without delivering it (`mail_settings.sandbox_mode`). */
  sandboxMode?: boolean;
  tracking?: { clicks?: boolean; opens?: boolean; subscription?: boolean };
};

export function sendgrid(
  options: SendGridAdapterOptions,
): EmailAdapter<"sendgrid", { baseUrl: string }, unknown, SendGridNativeOptions> {
  const provider = jsonProvider<"sendgrid", SendGridPayload, SendGridNativeOptions>({
    name: "sendgrid",
    baseUrl: options.baseUrl ?? "https://api.sendgrid.com",
    endpoint: "/v3/mail/send",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    fetch: options.fetch,
    async buildPayload(message, native) {
      const payload = {
        personalizations: sendgridPersonalizations(message, native),
        from: apiAddress(message.from),
        reply_to_list: optionalApiAddresses(message.replyTo),
        subject: message.subject,
        content: [
          ...(message.text ? [{ type: "text/plain", value: message.text }] : []),
          ...(message.html ? [{ type: "text/html", value: message.html }] : []),
        ],
        attachments: await sendgridAttachments(message),
        categories: message.tags?.map((tag) => tag.value),
        send_at: sendAtUnixSeconds(message),
      };

      return native ? withSendGridNative(payload, native) : payload;
    },
    parseResponse(body, _message, response) {
      return {
        adapter: "sendgrid",
        id:
          firstString(body, ["id", "message_id"]) ??
          response.headers.get("x-message-id") ??
          undefined,
        raw: body,
      };
    },
  });

  return {
    ...provider,
    async sendPersonalized(input, context) {
      const recipientVariables = Object.fromEntries(
        input.recipients.map((recipient) => [emailAddressOf(recipient.to), recipient.variables]),
      );

      const result = await provider.send(
        // SAFETY: input.message is an EmailMessage without its recipient fields, and `to` restores
        // them. recipientVariables is the legacy extension read by sendgridPersonalizations.
        {
          ...input.message,
          to: input.recipients.map((recipient) => recipient.to),
          recipientVariables,
        } as EmailMessage,
        context,
      );

      return {
        ...result,
        accepted: input.recipients.map((recipient) => emailAddressOf(recipient.to)),
        rejected: [],
      };
    },
  };
}

type SendGridPersonalization = {
  to: ReturnType<typeof apiAddresses>;
  cc?: ReturnType<typeof optionalApiAddresses>;
  bcc?: ReturnType<typeof optionalApiAddresses>;
  headers: ReturnType<typeof commonHeadersObject>;
  custom_args: EmailMessage["metadata"];
  substitutions?: Record<string, string>;
  dynamic_template_data?: EmailNativeObject;
};

type SendGridPayload = {
  personalizations: SendGridPersonalization[];
  from: ReturnType<typeof apiAddress>;
  reply_to_list: ReturnType<typeof optionalApiAddresses>;
  subject: string;
  content?: { type: string; value: string }[];
  attachments: Awaited<ReturnType<typeof sendgridAttachments>>;
  categories?: string[];
  send_at?: number;
  template_id?: string;
  asm?: { group_id: number; groups_to_display?: readonly number[] };
  ip_pool_name?: string;
  batch_id?: string;
  mail_settings?: { sandbox_mode: { enable: boolean } };
  tracking_settings?: {
    click_tracking?: { enable: boolean };
    open_tracking?: { enable: boolean };
    subscription_tracking?: { enable: boolean };
  };
};

function withSendGridNative(payload: SendGridPayload, native: SendGridNativeOptions) {
  const tracking = native.tracking;

  const withNative: SendGridPayload = {
    ...payload,
    content: native.templateId ? undefined : payload.content,
    template_id: native.templateId,
    asm: native.asm && {
      group_id: native.asm.groupId,
      groups_to_display: native.asm.groupsToDisplay,
    },
    ip_pool_name: native.ipPoolName,
    batch_id: native.batchId,
    mail_settings:
      native.sandboxMode === undefined ? undefined : { sandbox_mode: { enable: native.sandboxMode } },
    tracking_settings: tracking && {
      click_tracking: enabled(tracking.clicks),
      open_tracking: enabled(tracking.opens),
      subscription_tracking: enabled(tracking.subscription),
    },
  };

  return native.body ? { ...withNative, ...native.body } : withNative;
}

function enabled(enable: boolean | undefined) {
  return enable === undefined ? undefined : { enable };
}

// With recipientVariables, emit one personalization per recipient so SendGrid substitutes
// each recipient's %recipient.key% tokens in a single API call; otherwise one shared personalization.
// A dynamic template reads per-recipient values from dynamic_template_data instead.
function sendgridPersonalizations(
  message: EmailMessage,
  native: SendGridNativeOptions | undefined,
): SendGridPersonalization[] {
  const templateData = native?.dynamicTemplateData;

  if (hasRecipientVariables(message)) {
    // SendGrid caps personalizations at 1000 per request; fail fast like Mailgun does.
    assertMaxItems("sendgrid", "recipient", arrayify(message.to), 1000);

    return recipientVariableEntries(message).map((entry) => ({
      to: [apiAddress(entry.to)],
      headers: commonHeadersObject(message),
      custom_args: message.metadata,
      ...(native?.templateId
        ? { dynamic_template_data: { ...templateData, ...entry.variables } }
        : { substitutions: recipientSubstitutions(entry.variables) }),
    }));
  }

  return [
    {
      to: apiAddresses(message.to),
      cc: optionalApiAddresses(message.cc),
      bcc: optionalApiAddresses(message.bcc),
      headers: commonHeadersObject(message),
      custom_args: message.metadata,
      dynamic_template_data: templateData,
    },
  ];
}

function recipientSubstitutions(variables: Record<string, string | number | boolean>) {
  const substitutions: Record<string, string> = {};

  for (const [key, value] of Object.entries(variables)) {
    substitutions[`%recipient.${key}%`] = String(value);
  }

  return substitutions;
}
