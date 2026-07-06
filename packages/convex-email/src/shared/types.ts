import type { EmailAddress, EmailHeader, EmailTag } from "@opencoredev/email-sdk";

export type ConvexEmailAttachment = {
  filename: string;
  content?: string;
  contentEncoding?: "raw" | "base64";
  url?: string;
  contentType?: string;
  contentId?: string;
  disposition?: "attachment" | "inline";
};

export type ConvexEmailMessage = {
  from: EmailAddress;
  to: EmailAddress | EmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  cc?: EmailAddress | EmailAddress[];
  bcc?: EmailAddress | EmailAddress[];
  replyTo?: EmailAddress | EmailAddress[];
  headers?: Record<string, string> | EmailHeader[];
  attachments?: ConvexEmailAttachment[];
  tags?: EmailTag[];
  metadata?: Record<string, string | number | boolean | null>;
  idempotencyKey?: string;
};

export type ConvexEmailAdapterConfig =
  | {
      kind: "memory";
      name?: string;
    }
  | {
      kind: "brevo";
      name?: string;
      apiKeyEnv?: string;
      baseUrl?: string;
    }
  | {
      kind: "cloudflare";
      name?: string;
      apiTokenEnv?: string;
      accountIdEnv?: string;
      accountId?: string;
      baseUrl?: string;
    }
  | {
      kind: "iterable";
      name?: string;
      apiKeyEnv?: string;
      campaignIdEnv?: string;
      campaignId?: number;
      allowRepeatMarketingSends?: boolean;
      dataFields?: Record<string, string | number | boolean | null>;
      sendAt?: string;
      baseUrl?: string;
    }
  | {
      kind: "loops";
      name?: string;
      apiKeyEnv?: string;
      baseUrl?: string;
    }
  | {
      kind: "mailchimp";
      name?: string;
      apiKeyEnv?: string;
      baseUrl?: string;
    }
  | {
      kind: "mailersend";
      name?: string;
      apiKeyEnv?: string;
      baseUrl?: string;
    }
  | {
      kind: "mailgun";
      name?: string;
      apiKeyEnv?: string;
      domainEnv?: string;
      domain?: string;
      baseUrl?: string;
    }
  | {
      kind: "mailpace";
      name?: string;
      apiKeyEnv?: string;
      baseUrl?: string;
    }
  | {
      kind: "mailtrap";
      name?: string;
      apiKeyEnv?: string;
      baseUrl?: string;
    }
  | {
      kind: "plunk";
      name?: string;
      apiKeyEnv?: string;
      baseUrl?: string;
    }
  | {
      kind: "resend";
      name?: string;
      apiKeyEnv?: string;
      baseUrl?: string;
    }
  | {
      kind: "postmark";
      name?: string;
      serverTokenEnv?: string;
      messageStream?: string;
      baseUrl?: string;
    }
  | {
      kind: "sendgrid";
      name?: string;
      apiKeyEnv?: string;
      baseUrl?: string;
    }
  | {
      kind: "ses";
      name?: string;
      accessKeyIdEnv?: string;
      secretAccessKeyEnv?: string;
      sessionTokenEnv?: string;
      regionEnv?: string;
      region?: string;
      baseUrl?: string;
    }
  | {
      kind: "scaleway";
      name?: string;
      secretKeyEnv?: string;
      projectIdEnv?: string;
      projectId?: string;
      regionEnv?: string;
      region?: string;
      baseUrl?: string;
    }
  | {
      kind: "sequenzy";
      name?: string;
      apiKeyEnv?: string;
      baseUrl?: string;
    }
  | {
      kind: "smtp";
      name?: string;
      hostEnv?: string;
      portEnv?: string;
      secureEnv?: string;
      userEnv?: string;
      passEnv?: string;
      host?: string;
      port?: number;
      secure?: boolean;
    }
  | {
      kind: "sparkpost";
      name?: string;
      apiKeyEnv?: string;
      baseUrl?: string;
    }
  | {
      kind: "unosend";
      name?: string;
      apiKeyEnv?: string;
      baseUrl?: string;
    }
  | {
      kind: "zeptomail";
      name?: string;
      tokenEnv?: string;
      baseUrl?: string;
    };

export type ConvexEmailSendArgs = Omit<ConvexEmailMessage, "from"> & {
  from?: EmailAddress;
  adapter?: string;
  fallbackAdapters?: string[];
  retries?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  adapters?: ConvexEmailAdapterConfig[];
  sendMetadata?: Record<string, string | number | boolean | null>;
};

export type ConvexEmailConfig = {
  testMode?: boolean;
  sandboxTo?: string[];
  defaultFrom?: string;
  maxAttempts?: number;
  retryBaseMs?: number;
  cleanupAfterDays?: number;
};

export type ConvexEmailStatus = "queued" | "processing" | "sent" | "failed" | "canceled";

export type ConvexEmailDeliveryStatus = "delivered" | "bounced" | "complained";

export type ConvexEmailDoc = {
  _id: string;
  _creationTime: number;
  status: ConvexEmailStatus;
  message: ConvexEmailMessage;
  adapter?: string;
  attemptedAdapters: string[];
  fallbackAdapters: string[];
  adapters: ConvexEmailAdapterConfig[];
  providerMessageId?: string;
  idempotencyKey?: string;
  sendMetadata?: Record<string, string | number | boolean | null>;
  attemptCount: number;
  maxAttempts: number;
  retryBaseMs: number;
  nextAttemptAt?: number;
  lastError?: string;
  deliveryStatus?: ConvexEmailDeliveryStatus;
  deliveredAt?: number;
  createdAt: number;
  updatedAt: number;
  sentAt?: number;
  terminalAt?: number;
};

export type ConvexEmailEventDoc = {
  _id: string;
  _creationTime: number;
  emailId: string;
  type: ConvexEmailEventType;
  adapter?: string;
  attempt?: number;
  providerMessageId?: string;
  payload?: unknown;
  error?: string;
  createdAt: number;
};

export type ConvexEmailEventType =
  | "queued"
  | "processing"
  | "provider_attempt"
  | "sent"
  | "retry_scheduled"
  | "failed"
  | "canceled"
  | "webhook";
