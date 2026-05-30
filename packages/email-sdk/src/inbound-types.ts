import type { MaybePromise } from "./types.js";

export type InboundEmailAddress = {
  email: string;
  name?: string;
};

export type InboundEmailAttachment = {
  filename?: string;
  contentType?: string;
  contentId?: string;
  disposition?: "attachment" | "inline";
  size?: number;
  content?: string | Uint8Array | ArrayBuffer | Blob;
  url?: string;
  raw?: unknown;
};

export type InboundEmail = {
  id?: string;
  provider: string;
  from: InboundEmailAddress;
  to: InboundEmailAddress[];
  cc?: InboundEmailAddress[];
  bcc?: InboundEmailAddress[];
  replyTo?: InboundEmailAddress[];
  subject?: string;
  text?: string;
  html?: string;
  headers: Record<string, string>;
  attachments: InboundEmailAttachment[];
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  receivedAt?: Date;
  raw?: unknown;
};

export type InboundParseContext = {
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
};

export type InboundEmailAdapter<TRaw = unknown> = {
  name: string;
  parse(input: Request | unknown, context: InboundParseContext): MaybePromise<InboundEmail>;
  verify?: (input: Request | unknown) => MaybePromise<boolean>;
  raw?: TRaw;
};

export type InboundEmailClientOptions = {
  adapters: InboundEmailAdapter[];
  defaultAdapter?: string;
};

export type InboundParseOptions = {
  adapter?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type InboundVerifyOptions = {
  adapter?: string;
};

export type InboundEmailClient = {
  readonly adapters: ReadonlyMap<string, InboundEmailAdapter>;
  readonly defaultAdapter: string;
  parse(input: Request | unknown, options?: InboundParseOptions): Promise<InboundEmail>;
  verify(input: Request | unknown, options?: InboundVerifyOptions): Promise<boolean>;
  adapter<TAdapter extends InboundEmailAdapter = InboundEmailAdapter>(name: string): TAdapter;
};
