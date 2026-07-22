declare module "@opencoredev/email-sdk" {
  export type MaybePromise<T> = T | Promise<T>;

  export type EmailAddress =
    | string
    | {
        email: string;
        name?: string;
      };

  export type EmailHeader = {
    name: string;
    value: string;
  };

  export type EmailTag = {
    name: string;
    value: string;
  };

  export type EmailAttachment = {
    filename: string;
    content?: string | Uint8Array | ArrayBuffer | Blob;
    contentEncoding?: "raw" | "base64";
    path?: string;
    contentType?: string;
    contentId?: string;
    disposition?: "attachment" | "inline";
  };

  export type EmailMessage = {
    from: EmailAddress;
    to: EmailAddress | EmailAddress[];
    subject: string;
    html?: string;
    text?: string;
    cc?: EmailAddress | EmailAddress[];
    bcc?: EmailAddress | EmailAddress[];
    replyTo?: EmailAddress | EmailAddress[];
    headers?: Record<string, string> | EmailHeader[];
    attachments?: EmailAttachment[];
    tags?: EmailTag[];
    metadata?: Record<string, string | number | boolean | null>;
    idempotencyKey?: string;
  };

  export type EmailProviderResponse = {
    id?: string;
    provider: string;
    messageId?: string;
    accepted?: string[];
    rejected?: string[];
    raw?: unknown;
  };

  export type EmailProviderContext = {
    signal?: AbortSignal;
    idempotencyKey?: string;
    attempt: number;
    metadata?: Record<string, unknown>;
  };

  export type EmailHookEvent = {
    provider: string;
    message: EmailMessage;
    attempt: number;
    metadata?: Record<string, unknown>;
  };

  export type EmailHooks = {
    beforeSend?: (event: EmailHookEvent) => MaybePromise<void>;
    afterSend?: (event: EmailHookEvent & { response: EmailProviderResponse }) => MaybePromise<void>;
    onError?: (event: EmailHookEvent & { error: unknown }) => MaybePromise<void>;
    onRetry?: (
      event: EmailHookEvent & { error: unknown; nextAttempt: number; delayMs: number }
    ) => MaybePromise<void>;
  };

  export type EmailProvider = {
    name: string;
    send(message: EmailMessage, context: EmailProviderContext): MaybePromise<EmailProviderResponse>;
  };

  export type SendOptions = {
    adapter?: string;
    fallbackAdapters?: string[];
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  };

  export type EmailClient = {
    send(message: EmailMessage, options?: SendOptions): Promise<EmailProviderResponse>;
  };

  export function createEmailClient(options: {
    adapters: EmailProvider[];
    defaultAdapter?: string;
    fallback?: string[];
    hooks?: EmailHooks;
    plugins?: unknown[];
  }): EmailClient;
}

declare module "@opencoredev/email-sdk/testing" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function memoryAdapter(name?: string): EmailProvider;
}

declare module "@opencoredev/email-sdk/plugins/defaults" {
  export function defaultsPlugin(options?: unknown): unknown;
}

declare module "@opencoredev/email-sdk/plugins/observability" {
  export function observabilityPlugin(options?: { log?: (event: unknown) => void }): unknown;
}

declare module "@opencoredev/email-sdk/resend" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function resend(options: { apiKey: string; baseUrl?: string }): EmailProvider;
}

declare module "@opencoredev/email-sdk/brevo" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function brevo(options: { apiKey: string; baseUrl?: string }): EmailProvider;
}

declare module "@opencoredev/email-sdk/cloudflare" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function cloudflare(options: {
    apiToken: string;
    accountId: string;
    baseUrl?: string;
  }): EmailProvider;
}

declare module "@opencoredev/email-sdk/iterable" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function iterable(options: {
    apiKey: string;
    campaignId: number;
    allowRepeatMarketingSends?: boolean;
    dataFields?: Record<string, unknown>;
    sendAt?: string;
    baseUrl?: string;
  }): EmailProvider;
}

declare module "@opencoredev/email-sdk/loops" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function loops(options: { apiKey: string; baseUrl?: string }): EmailProvider;
}

declare module "@opencoredev/email-sdk/mailchimp" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function mailchimp(options: { apiKey: string; baseUrl?: string }): EmailProvider;
}

declare module "@opencoredev/email-sdk/mailersend" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function mailersend(options: { apiKey: string; baseUrl?: string }): EmailProvider;
}

declare module "@opencoredev/email-sdk/mailgun" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function mailgun(options: {
    apiKey: string;
    domain: string;
    baseUrl?: string;
  }): EmailProvider;
}

declare module "@opencoredev/email-sdk/mailpace" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function mailpace(options: { apiKey: string; baseUrl?: string }): EmailProvider;
}

declare module "@opencoredev/email-sdk/mailtrap" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function mailtrap(options: { apiKey: string; baseUrl?: string }): EmailProvider;
}

declare module "@opencoredev/email-sdk/plunk" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function plunk(options: { apiKey: string; baseUrl?: string }): EmailProvider;
}

declare module "@opencoredev/email-sdk/postmark" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function postmark(options: {
    serverToken: string;
    messageStream?: string;
    baseUrl?: string;
  }): EmailProvider;
}

declare module "@opencoredev/email-sdk/sendgrid" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function sendgrid(options: { apiKey: string; baseUrl?: string }): EmailProvider;
}

declare module "@opencoredev/email-sdk/ses" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function ses(options: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region: string;
    configurationSetName?: string;
    baseUrl?: string;
  }): EmailProvider;
}

declare module "@opencoredev/email-sdk/scaleway" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function scaleway(options: {
    secretKey: string;
    projectId: string;
    region?: string;
    baseUrl?: string;
  }): EmailProvider;
}

declare module "@opencoredev/email-sdk/sequenzy" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function sequenzy(options: { apiKey: string; baseUrl?: string }): EmailProvider;
}

declare module "@opencoredev/email-sdk/smtp" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function smtp(options: {
    name?: string;
    host: string;
    port?: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
  }): EmailProvider;
}

declare module "@opencoredev/email-sdk/sparkpost" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function sparkpost(options: { apiKey: string; baseUrl?: string }): EmailProvider;
}

declare module "@opencoredev/email-sdk/unosend" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function unosend(options: { apiKey: string; baseUrl?: string }): EmailProvider;
}

declare module "@opencoredev/email-sdk/zeptomail" {
  import type { EmailProvider } from "@opencoredev/email-sdk";

  export function zeptomail(options: { token: string; baseUrl?: string }): EmailProvider;
}
