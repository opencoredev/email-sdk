import type { EmailAddress, EmailHeader, EmailTag } from "@opencoredev/email-sdk";

import type {
  ConvexAdapterField,
  ConvexEmailAdapterKind,
  ConvexEmailAdapterRegistry,
} from "./adapters.js";

export type { ConvexEmailAdapterKind } from "./adapters.js";

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

export type ConvexEmailMetadataValue = string | number | boolean | null;

type ConvexAdapterFieldValue<TField extends ConvexAdapterField> = TField extends {
  type: "number";
}
  ? number
  : TField extends { type: "boolean" }
    ? boolean
    : TField extends { type: "record" }
      ? Record<string, ConvexEmailMetadataValue>
      : string;

/** `<field>Env` keys for every field that can be sourced from the component environment. */
type ConvexAdapterEnvKeys<TFields> = {
  [K in keyof TFields as TFields[K] extends { env: string } ? `${K & string}Env` : never]?: string;
};

/** Literal value keys for every field that is safe to store inline in adapter config. */
type ConvexAdapterInlineKeys<TFields> = {
  [K in keyof TFields as TFields[K] extends { inline: true }
    ? K
    : never]?: TFields[K] extends ConvexAdapterField ? ConvexAdapterFieldValue<TFields[K]> : never;
};

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type ConvexEmailAdapterConfigFor<TKind extends ConvexEmailAdapterKind> = Simplify<
  { kind: TKind; name?: string } & ConvexAdapterEnvKeys<ConvexEmailAdapterRegistry[TKind]> &
    ConvexAdapterInlineKeys<ConvexEmailAdapterRegistry[TKind]>
>;

/**
 * Discriminated union of every adapter configuration accepted by the component, derived from
 * `CONVEX_EMAIL_ADAPTERS`. Adding an adapter to that registry adds it here automatically.
 */
export type ConvexEmailAdapterConfig = {
  [TKind in ConvexEmailAdapterKind]: ConvexEmailAdapterConfigFor<TKind>;
}[ConvexEmailAdapterKind];

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
  /** Server-controlled owner recorded by exposeApi(). */
  ownerId?: string;
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
