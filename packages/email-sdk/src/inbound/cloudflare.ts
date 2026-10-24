import { emailFromMime } from "./normalize.js";
import { payloadError } from "./shared.js";
import type { InboundEmail } from "./types.js";

const provider = "cloudflare";

/**
 * The parts of Cloudflare's `ForwardableEmailMessage` this parser reads. Pass the `message`
 * argument of an Email Worker's `email(message, env, ctx)` handler directly.
 */
export interface CloudflareEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
}

/**
 * Parse the email an Email Worker received. The raw stream can only be read once, so call
 * this before `message.forward()` if you need both, or keep the returned `raw.bytes`.
 */
export async function parseCloudflareInbound(message: CloudflareEmailMessage): Promise<InboundEmail> {
  let bytes: Uint8Array;

  try {
    bytes = new Uint8Array(await new Response(message.raw).arrayBuffer());
  } catch (error) {
    throw payloadError(provider, "Cloudflare email raw stream could not be read; it may already be consumed.", error instanceof Error ? error : undefined);
  }

  return emailFromMime({ provider, raw: bytes, envelope: { from: message.from, to: [message.to] } });
}
