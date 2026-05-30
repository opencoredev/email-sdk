export { createEmailClient } from "./core.js";
export { createInboundEmailClient } from "./inbound-core.js";
export {
  EmailProviderError,
  EmailProviderNotFoundError,
  EmailSdkError,
  EmailValidationError,
  isRetryableEmailError,
} from "./errors.js";
export type {
  EmailAddress,
  EmailAttachment,
  EmailClient,
  EmailClientOptions,
  EmailHeader,
  EmailHooks,
  EmailMessage,
  EmailProvider,
  EmailProviderContext,
  EmailProviderResponse,
  EmailRetryConfig,
  EmailTag,
  SendBatchItem,
  SendBatchResult,
  SendOptions,
} from "./types.js";
export type {
  InboundEmail,
  InboundEmailAdapter,
  InboundEmailAddress,
  InboundEmailAttachment,
  InboundEmailClient,
  InboundEmailClientOptions,
  InboundParseContext,
  InboundParseOptions,
  InboundVerifyOptions,
} from "./inbound-types.js";
