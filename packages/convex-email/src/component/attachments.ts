"use node";

/**
 * Fetches URL attachments for queued email without letting a caller point the worker at internal
 * infrastructure.
 *
 * The worker runs in Convex's Node runtime, so this module resolves DNS itself (`node:dns`) and
 * connects with `node:https`. Every hop, including each redirect, is checked in three steps:
 *
 * 1. The URL must be https, carry no credentials, and not name a literal IP or an obviously internal
 *    host such as `localhost` or `*.internal`.
 * 2. The hostname is resolved, and the request is refused if ANY returned address is loopback,
 *    private, link-local, CGNAT, multicast, reserved, documentation, a cloud metadata endpoint, or
 *    an IPv4-mapped/compatible/NAT64/6to4 form of one of those.
 * 3. The connection is pinned to the addresses that passed step 2 through a custom `lookup`, so the
 *    socket cannot re-resolve the name to something else between the check and the connect (DNS
 *    rebinding). TLS still verifies the certificate against the original hostname.
 */
import type { EmailAttachment } from "@opencoredev/email-sdk";
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import type { Readable } from "node:stream";

import type { ConvexEmailAttachment } from "../shared/types.js";

export type ResolvedAddress = { address: string; family: 4 | 6 };

/** Resolves a hostname to every address a connection could use. */
export type HostResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export type AttachmentTransportRequest = {
  url: URL;
  /** Addresses that passed the public-address check; the connection must use one of them. */
  addresses: readonly ResolvedAddress[];
  signal: AbortSignal;
};

/** Performs one GET without following redirects. */
export type AttachmentTransport = (request: AttachmentTransportRequest) => Promise<Response>;

export type AttachmentFetchOptions = {
  resolveHost?: HostResolver;
  transport?: AttachmentTransport;
  timeoutMs?: number;
};

export const MAX_ATTACHMENT_REDIRECTS = 3;

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const ATTACHMENT_FETCH_TIMEOUT_MS = 10_000;

export async function hydrateAttachment(
  attachment: ConvexEmailAttachment,
  options: AttachmentFetchOptions = {},
): Promise<EmailAttachment> {
  const { url, ...base } = attachment;

  if (attachment.content !== undefined) {
    return { ...base, content: attachment.content };
  }

  if (!url) {
    throw new Error(`Attachment "${attachment.filename}" requires \`content\` or \`url\`.`);
  }

  return { ...base, content: await fetchAttachment(url, attachment.filename, options) };
}

export async function fetchAttachment(
  value: string,
  filename: string,
  options: AttachmentFetchOptions = {},
): Promise<ArrayBuffer> {
  const resolveHost = options.resolveHost ?? resolveHostAddresses;
  const transport = options.transport ?? httpsTransport;
  let url = safeAttachmentUrl(value, filename);
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? ATTACHMENT_FETCH_TIMEOUT_MS,
  );

  try {
    for (let redirects = 0; redirects <= MAX_ATTACHMENT_REDIRECTS; redirects += 1) {
      const addresses = await publicAddressesFor(url, filename, resolveHost, controller.signal);
      const response = await transport({ url, addresses, signal: controller.signal });

      if (isRedirect(response.status)) {
        await response.body?.cancel();

        if (redirects === MAX_ATTACHMENT_REDIRECTS) {
          throw new Error(`Attachment "${filename}" exceeded the redirect limit.`);
        }

        const location = response.headers.get("location");

        if (!location) {
          throw new Error(`Attachment "${filename}" redirect is missing a location.`);
        }

        url = safeRedirectTarget(location, url, filename);
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Failed to fetch email attachment "${filename}" from ${value}.`);
      }

      const encoding = response.headers.get("content-encoding");

      // The request asks for identity; node:https would hand compressed bytes straight to the email.
      if (encoding && encoding.toLowerCase() !== "identity") {
        await response.body?.cancel();
        throw new Error(`Attachment "${filename}" was sent with unsupported content encoding "${encoding}".`);
      }

      return await readAttachmentBody(response, filename);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Fetching email attachment "${filename}" timed out.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  throw new Error(`Attachment "${filename}" exceeded the redirect limit.`);
}

async function publicAddressesFor(
  url: URL,
  filename: string,
  resolveHost: HostResolver,
  signal: AbortSignal,
) {
  let addresses: readonly ResolvedAddress[];

  try {
    addresses = await untilAborted(resolveHost(hostnameOf(url)), signal);
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    throw new Error(`Attachment "${filename}" URL host could not be resolved.`);
  }

  if (addresses.length === 0) {
    throw new Error(`Attachment "${filename}" URL host could not be resolved.`);
  }

  if (!addresses.every((entry) => isPublicAddress(entry.address))) {
    throw new Error(`Attachment "${filename}" URL host resolves to a non-public address.`);
  }

  return addresses;
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("Attachment fetch aborted."));

    if (signal.aborted) {
      onAbort();

      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (cause: Error) => {
        signal.removeEventListener("abort", onAbort);
        reject(cause);
      },
    );
  });
}

/** The default resolver: every A and AAAA record the system resolver returns. */
export async function resolveHostAddresses(hostname: string): Promise<readonly ResolvedAddress[]> {
  const results = await lookup(hostname, { all: true });

  return results.map((result) => ({
    address: result.address,
    family: addressFamily(result.address),
  }));
}

function addressFamily(address: string): 4 | 6 {
  const family = isIP(stripZone(address));

  if (family === 4 || family === 6) {
    return family;
  }

  throw new Error(`Resolver returned a non-IP address "${address}".`);
}

/**
 * A `lookup` for `node:https` that only ever answers with the pre-validated addresses. Node calls
 * it with `all: true` when happy-eyeballs is enabled and without it otherwise, so both callback
 * forms are supported.
 */
export function pinnedLookup(addresses: readonly ResolvedAddress[]): LookupFunction {
  return (hostname, options, callback) => {
    const family = requestedFamily(options.family);
    const candidates = family ? addresses.filter((entry) => entry.family === family) : addresses;
    const [first] = candidates;

    if (!first) {
      const error: NodeJS.ErrnoException = new Error(
        `No validated IPv${family ?? ""} address for ${hostname}.`,
      );

      error.code = "ENOTFOUND";
      callback(error, "", 0);

      return;
    }

    if (options.all) {
      const all: LookupAddress[] = candidates.map((entry) => ({
        address: entry.address,
        family: entry.family,
      }));

      callback(null, all);

      return;
    }

    callback(null, first.address, first.family);
  };
}

function requestedFamily(family: number | "IPv4" | "IPv6" | undefined): 4 | 6 | undefined {
  if (family === 4 || family === "IPv4") {
    return 4;
  }

  if (family === 6 || family === "IPv6") {
    return 6;
  }

  return undefined;
}

/** The production transport: one pinned `node:https` GET, exposed as a fetch `Response`. */
export const httpsTransport: AttachmentTransport = ({ url, addresses, signal }) =>
  new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      {
        method: "GET",
        // A fresh agent per request: a pooled socket could have been opened for another address.
        agent: false,
        lookup: pinnedLookup(addresses),
        signal,
        headers: { accept: "*/*", "accept-encoding": "identity" },
      },
      (incoming) => {
        try {
          resolve(toResponse(incoming));
        } catch (cause) {
          incoming.destroy();
          reject(cause);
        }
      },
    );

    outgoing.on("error", reject);
    outgoing.end();
  });

function toResponse(incoming: IncomingMessage) {
  const status = incoming.statusCode ?? 0;
  const headers = new Headers();

  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) {
      continue;
    }

    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, item);
    }
  }

  if (status === 204 || status === 205 || status === 304) {
    incoming.resume();

    return new Response(null, { status, headers });
  }

  return new Response(bodyStream(incoming), { status, headers });
}

/** Pauses the socket whenever the stream queue is full, so the size cap bounds buffered memory. */
export function bodyStream(incoming: Readable) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      incoming.pause();

      incoming.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));

        if ((controller.desiredSize ?? 0) <= 0) incoming.pause();
      });

      incoming.on("end", () => controller.close());
      incoming.on("error", (error) => controller.error(error));
    },
    pull() {
      incoming.resume();
    },
    cancel() {
      incoming.destroy();
    },
  });
}

function isRedirect(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function safeRedirectTarget(location: string, base: URL, filename: string) {
  let target: URL;

  try {
    target = new URL(location, base);
  } catch {
    throw new Error(`Attachment "${filename}" redirect has an invalid URL.`);
  }

  return safeAttachmentUrl(target.toString(), filename);
}

async function readAttachmentBody(response: Response, filename: string): Promise<ArrayBuffer> {
  const contentLength = response.headers.get("content-length");

  if (contentLength && Number(contentLength) > MAX_ATTACHMENT_BYTES) {
    await response.body?.cancel();
    throw new Error(
      `Attachment "${filename}" exceeds the ${MAX_ATTACHMENT_BYTES}-byte size limit.`,
    );
  }

  if (!response.body) {
    return new ArrayBuffer(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      size += value.byteLength;

      if (size > MAX_ATTACHMENT_BYTES) {
        await reader.cancel();
        throw new Error(
          `Attachment "${filename}" exceeds the ${MAX_ATTACHMENT_BYTES}-byte size limit.`,
        );
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const content = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return content.buffer;
}

function hostnameOf(url: URL) {
  return url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
}

export function safeAttachmentUrl(value: string, filename: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`Attachment "${filename}" has an invalid URL.`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`Attachment "${filename}" URL must use https.`);
  }

  if (url.username || url.password) {
    throw new Error(`Attachment "${filename}" URL cannot include credentials.`);
  }

  const hostname = hostnameOf(url);

  if (
    hostname === "" ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    isIpAddressLiteral(hostname)
  ) {
    throw new Error(`Attachment "${filename}" URL host is not allowed.`);
  }

  return url;
}

function isIpAddressLiteral(hostname: string) {
  return isIP(hostname) !== 0 || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":");
}

/**
 * Cloud instance-metadata endpoints. Every entry already falls inside a blocked range below; they
 * are listed so the intent survives any future change to those ranges.
 */
const METADATA_ADDRESSES = new Set([
  "169.254.169.254", // AWS, GCP, Azure, DigitalOcean, Oracle, OpenStack
  "169.254.170.2", // AWS ECS task metadata
  "169.254.169.123", // AWS time sync
  "100.100.100.200", // Alibaba Cloud
  "192.0.0.192", // Oracle Cloud legacy
  "fd00:ec2::254", // AWS IPv6 instance metadata
  "fd00:ec2::23", // AWS IPv6 DNS
]);

type Ipv4Range = readonly [base: string, prefix: number];

/** IPv4 ranges that are never public unicast destinations (IANA special-purpose registry). */
const BLOCKED_IPV4_RANGES: readonly Ipv4Range[] = [
  ["0.0.0.0", 8], // "this network", includes the unspecified address
  ["10.0.0.0", 8], // RFC 1918 private
  ["100.64.0.0", 10], // RFC 6598 carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata
  ["172.16.0.0", 12], // RFC 1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1 documentation
  ["192.31.196.0", 24], // AS112-v4
  ["192.52.193.0", 24], // AMT
  ["192.88.99.0", 24], // deprecated 6to4 relay anycast
  ["192.168.0.0", 16], // RFC 1918 private
  ["192.175.48.0", 24], // direct delegation AS112
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2 documentation
  ["203.0.113.0", 24], // TEST-NET-3 documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes 255.255.255.255 broadcast
];

/** Whether an attachment fetch may connect to `address`. Anything unparseable is refused. */
export function isPublicAddress(address: string) {
  const bare = stripZone(address).toLowerCase();

  if (METADATA_ADDRESSES.has(bare)) {
    return false;
  }

  const family = isIP(bare);

  if (family === 4) {
    const value = parseIpv4(bare);

    return value !== undefined && isPublicIpv4(value);
  }

  if (family === 6) {
    const words = parseIpv6(bare);

    return words !== undefined && isPublicIpv6(words);
  }

  return false;
}

function stripZone(address: string) {
  const zone = address.indexOf("%");

  return zone === -1 ? address : address.slice(0, zone);
}

function parseIpv4(address: string) {
  const parts = address.split(".");

  if (parts.length !== 4) {
    return undefined;
  }

  let value = 0;

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return undefined;
    }

    const octet = Number(part);

    if (octet > 255) {
      return undefined;
    }

    value = value * 256 + octet;
  }

  return value;
}

function isPublicIpv4(value: number) {
  return !BLOCKED_IPV4_RANGES.some(([base, prefix]) => {
    const start = parseIpv4(base) ?? 0;
    const size = 2 ** (32 - prefix);

    return value >= start && value < start + size;
  });
}

/** Parses a (zone-free) IPv6 address into its eight 16-bit words. */
function parseIpv6(address: string) {
  const halves = address.split("::");

  if (halves.length > 2) {
    return undefined;
  }

  const head = parseIpv6Words(halves[0] ?? "");
  const tail = halves.length === 2 ? parseIpv6Words(halves[1] ?? "") : [];

  if (!head || !tail) {
    return undefined;
  }

  const missing = 8 - head.length - tail.length;

  if (halves.length === 2 ? missing < 1 : missing !== 0) {
    return undefined;
  }

  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

function parseIpv6Words(part: string) {
  if (part === "") {
    return [];
  }

  const words: number[] = [];
  const pieces = part.split(":");

  for (const [index, piece] of pieces.entries()) {
    if (piece.includes(".")) {
      const embedded = index === pieces.length - 1 ? parseIpv4(piece) : undefined;

      if (embedded === undefined) {
        return undefined;
      }

      words.push(Math.floor(embedded / 0x10000), embedded % 0x10000);
      continue;
    }

    if (!/^[0-9a-f]{1,4}$/.test(piece)) {
      return undefined;
    }

    words.push(Number.parseInt(piece, 16));
  }

  return words;
}

function isPublicIpv6(words: readonly number[]) {
  const word = (index: number) => words[index] ?? 0;
  const zeroUntil = (end: number) => words.slice(0, end).every((value) => value === 0);
  const embeddedIpv4 = (high: number) => word(high) * 0x10000 + word(high + 1);

  // ::ffff:0:0/96 IPv4-mapped: judge the IPv4 address it carries.
  if (zeroUntil(5) && word(5) === 0xffff) {
    return isPublicIpv4(embeddedIpv4(6));
  }

  // ::ffff:0:0:0/96 IPv4-translated (SIIT).
  if (zeroUntil(4) && word(4) === 0xffff && word(5) === 0) {
    return isPublicIpv4(embeddedIpv4(6));
  }

  // ::/96 covers the unspecified address, loopback, and deprecated IPv4-compatible addresses.
  if (zeroUntil(6)) {
    return false;
  }

  // 64:ff9b::/96 well-known NAT64 prefix.
  if (word(0) === 0x64 && word(1) === 0xff9b && words.slice(2, 6).every((value) => value === 0)) {
    return isPublicIpv4(embeddedIpv4(6));
  }

  // 2002::/16 6to4 carries its IPv4 address in the next 32 bits.
  if (word(0) === 0x2002) {
    return isPublicIpv4(embeddedIpv4(1));
  }

  // Only 2000::/3 is allocated global unicast. This excludes fc00::/7 unique-local, fe80::/10
  // link-local, fec0::/10 site-local, ff00::/8 multicast, 100::/64 discard, 64:ff9b:1::/48 local
  // NAT64, and 5f00::/16 SRv6 SIDs.
  if ((word(0) & 0xe000) !== 0x2000) {
    return false;
  }

  // 2001::/23 IETF protocol assignments (Teredo, benchmarking, ORCHID, ...).
  if (word(0) === 0x2001 && word(1) < 0x0200) {
    return false;
  }

  // 2001:db8::/32 documentation.
  if (word(0) === 0x2001 && word(1) === 0x0db8) {
    return false;
  }

  // 3fff::/20 documentation.
  if (word(0) === 0x3fff && word(1) < 0x1000) {
    return false;
  }

  return true;
}
