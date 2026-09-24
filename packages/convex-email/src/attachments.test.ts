import { describe, expect, test } from "bun:test";
import type { LookupAddress } from "node:dns";

import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_REDIRECTS,
  fetchAttachment,
  isPublicAddress,
  pinnedLookup,
  type AttachmentTransport,
  type AttachmentTransportRequest,
  type HostResolver,
  type ResolvedAddress,
} from "./component/attachments.js";
import { hydrateAttachments } from "./component/providers.js";

const publicV4: ResolvedAddress = { address: "93.184.215.14", family: 4 };

const publicV6: ResolvedAddress = { address: "2606:2800:21f:cb07:6820:80da:af6b:8b2c", family: 6 };

function resolverFrom(records: Readonly<Record<string, readonly ResolvedAddress[]>>) {
  const byHost = new Map(Object.entries(records));
  const lookups: string[] = [];

  const resolveHost: HostResolver = async (hostname) => {
    lookups.push(hostname);
    const addresses = byHost.get(hostname);

    if (!addresses) {
      throw new Error(`ENOTFOUND ${hostname}`);
    }

    return addresses;
  };

  return { lookups, resolveHost };
}

function recordingTransport(
  respond: (request: AttachmentTransportRequest, call: number) => Response,
) {
  const requests: AttachmentTransportRequest[] = [];

  const transport: AttachmentTransport = async (request) => {
    requests.push(request);

    return respond(request, requests.length);
  };

  return { requests, transport };
}

function redirectTo(location: string) {
  return new Response(null, { status: 302, headers: { location } });
}

function decode(content: ArrayBuffer) {
  return new TextDecoder().decode(content);
}

describe("isPublicAddress", () => {
  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::",
    "::1",
    "::127.0.0.1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::ffff:0:10.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::10.0.0.1",
    "2002:c0a8:101::1",
    "2002:7f00:1::",
    "fc00::1",
    "fd00:ec2::254",
    "fe80::1",
    "fe80::1%eth0",
    "ff02::1",
    "2001:db8::1",
    "2001::1",
    "not-an-address",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  test.each([
    "93.184.215.14",
    "8.8.8.8",
    "2606:2800:21f:cb07:6820:80da:af6b:8b2c",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "2002:808:808::1",
  ])("allows %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe("fetchAttachment", () => {
  test("pins the connection to the addresses that passed validation", async () => {
    const { resolveHost, lookups } = resolverFrom({ "files.example.test": [publicV4, publicV6] });
    const { transport, requests } = recordingTransport(() => new Response("attachment"));

    const content = await fetchAttachment("https://files.example.test/a.txt", "a.txt", {
      resolveHost,
      transport,
    });

    expect(decode(content)).toBe("attachment");
    expect(lookups).toEqual(["files.example.test"]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url.href).toBe("https://files.example.test/a.txt");
    expect(requests[0]?.addresses).toEqual([publicV4, publicV6]);
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  test("refuses a public hostname that resolves to a private address", async () => {
    const { resolveHost } = resolverFrom({
      "rebind.example.test": [{ address: "10.0.0.5", family: 4 }],
    });

    const { transport, requests } = recordingTransport(() => new Response("secret"));

    await expect(
      fetchAttachment("https://rebind.example.test/a.txt", "a.txt", { resolveHost, transport }),
    ).rejects.toThrow('Attachment "a.txt" URL host resolves to a non-public address.');
    expect(requests).toHaveLength(0);
  });

  test("refuses a hostname when any one of its addresses is private", async () => {
    const { resolveHost } = resolverFrom({
      "mixed.example.test": [publicV4, { address: "169.254.169.254", family: 4 }],
    });

    const { transport, requests } = recordingTransport(() => new Response("secret"));

    await expect(
      fetchAttachment("https://mixed.example.test/a.txt", "a.txt", { resolveHost, transport }),
    ).rejects.toThrow("resolves to a non-public address");
    expect(requests).toHaveLength(0);
  });

  test.each([
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a9fe:a9fe",
    "2002:c0a8:101::1",
    "fe80::1%eth0",
  ])("refuses a hostname that resolves to the IPv6 form %s", async (address) => {
    const { resolveHost } = resolverFrom({ "v6.example.test": [{ address, family: 6 }] });
    const { transport, requests } = recordingTransport(() => new Response("secret"));

    await expect(
      fetchAttachment("https://v6.example.test/a.txt", "a.txt", { resolveHost, transport }),
    ).rejects.toThrow("resolves to a non-public address");
    expect(requests).toHaveLength(0);
  });

  test("re-resolves and refuses a redirect to a privately resolving host", async () => {
    const { resolveHost, lookups } = resolverFrom({
      "files.example.test": [publicV4],
      "internal-cdn.example.test": [{ address: "192.168.0.10", family: 4 }],
    });

    const { transport, requests } = recordingTransport(() =>
      redirectTo("https://internal-cdn.example.test/a.txt"),
    );

    await expect(
      fetchAttachment("https://files.example.test/a.txt", "a.txt", { resolveHost, transport }),
    ).rejects.toThrow("resolves to a non-public address");
    expect(lookups).toEqual(["files.example.test", "internal-cdn.example.test"]);
    expect(requests).toHaveLength(1);
  });

  test("follows a redirect to a public host and validates each hop", async () => {
    const { resolveHost, lookups } = resolverFrom({
      "files.example.test": [publicV4],
      "cdn.example.test": [publicV6],
    });

    const { transport, requests } = recordingTransport((_request, call) =>
      call === 1 ? redirectTo("https://cdn.example.test/a.txt") : new Response("attachment"),
    );

    const content = await fetchAttachment("https://files.example.test/a.txt", "a.txt", {
      resolveHost,
      transport,
    });

    expect(decode(content)).toBe("attachment");
    expect(lookups).toEqual(["files.example.test", "cdn.example.test"]);
    expect(requests.map((request) => request.addresses)).toEqual([[publicV4], [publicV6]]);
  });

  test("refuses a redirect to an IP literal without resolving or requesting it", async () => {
    const { resolveHost, lookups } = resolverFrom({ "files.example.test": [publicV4] });

    const { transport, requests } = recordingTransport(() =>
      redirectTo("https://127.0.0.1/private"),
    );

    await expect(
      fetchAttachment("https://files.example.test/a.txt", "private.txt", {
        resolveHost,
        transport,
      }),
    ).rejects.toThrow('Attachment "private.txt" URL host is not allowed.');
    expect(lookups).toEqual(["files.example.test"]);
    expect(requests).toHaveLength(1);
  });

  test("stops after the redirect limit", async () => {
    const { resolveHost } = resolverFrom({ "files.example.test": [publicV4] });

    const { transport, requests } = recordingTransport(() =>
      redirectTo("https://files.example.test/again"),
    );

    await expect(
      fetchAttachment("https://files.example.test/a.txt", "a.txt", { resolveHost, transport }),
    ).rejects.toThrow('Attachment "a.txt" exceeded the redirect limit.');
    expect(requests).toHaveLength(MAX_ATTACHMENT_REDIRECTS + 1);
  });

  test("reports a host that does not resolve", async () => {
    const { resolveHost } = resolverFrom({});
    const { transport } = recordingTransport(() => new Response("attachment"));

    await expect(
      fetchAttachment("https://missing.example.test/a.txt", "a.txt", { resolveHost, transport }),
    ).rejects.toThrow('Attachment "a.txt" URL host could not be resolved.');
  });

  test("rejects bodies over the size limit", async () => {
    const { resolveHost } = resolverFrom({ "files.example.test": [publicV4] });

    const { transport } = recordingTransport(
      () => new Response(new Uint8Array(MAX_ATTACHMENT_BYTES + 1)),
    );

    await expect(
      fetchAttachment("https://files.example.test/large.txt", "large.txt", {
        resolveHost,
        transport,
      }),
    ).rejects.toThrow(
      `Attachment "large.txt" exceeds the ${MAX_ATTACHMENT_BYTES}-byte size limit.`,
    );
  });

  test("times out when the body stalls after the response headers", async () => {
    const { resolveHost } = resolverFrom({ "files.example.test": [publicV4] });

    const transport: AttachmentTransport = async ({ signal }) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            signal.addEventListener("abort", () => controller.error(new Error("aborted")));
          },
        }),
      );

    await expect(
      fetchAttachment("https://files.example.test/stalled.txt", "stalled.txt", {
        resolveHost,
        transport,
        timeoutMs: 5,
      }),
    ).rejects.toThrow('Fetching email attachment "stalled.txt" timed out.');
  });

  test("times out when DNS resolution hangs", async () => {
    const resolveHost: HostResolver = () => new Promise(() => {});
    const { transport, requests } = recordingTransport(() => new Response("attachment"));

    await expect(
      fetchAttachment("https://files.example.test/a.txt", "a.txt", {
        resolveHost,
        transport,
        timeoutMs: 5,
      }),
    ).rejects.toThrow('Fetching email attachment "a.txt" timed out.');
    expect(requests).toHaveLength(0);
  });
});

describe("hydrateAttachments", () => {
  const message = {
    from: "Acme <hello@example.com>",
    to: "ada@example.com",
    subject: "Welcome",
    text: "Your account is ready.",
  };

  test("rejects unsafe attachment URLs before resolving them", async () => {
    const { resolveHost, lookups } = resolverFrom({});

    await expect(
      hydrateAttachments(
        {
          ...message,
          attachments: [{ filename: "metadata.txt", url: "http://169.254.169.254/latest" }],
        },
        { resolveHost },
      ),
    ).rejects.toThrow('Attachment "metadata.txt" URL must use https.');

    await expect(
      hydrateAttachments(
        {
          ...message,
          attachments: [{ filename: "loopback.txt", url: "https://127.0.0.1/private" }],
        },
        { resolveHost },
      ),
    ).rejects.toThrow('Attachment "loopback.txt" URL host is not allowed.');

    await expect(
      hydrateAttachments(
        {
          ...message,
          attachments: [{ filename: "mapped.txt", url: "https://[::ffff:127.0.0.1]/private" }],
        },
        { resolveHost },
      ),
    ).rejects.toThrow('Attachment "mapped.txt" URL host is not allowed.');

    await expect(
      hydrateAttachments(
        {
          ...message,
          attachments: [{ filename: "metadata.txt", url: "https://metadata.google.internal/" }],
        },
        { resolveHost },
      ),
    ).rejects.toThrow('Attachment "metadata.txt" URL host is not allowed.');

    expect(lookups).toEqual([]);
  });

  test("passes the fetch options through to every URL attachment", async () => {
    const { resolveHost } = resolverFrom({ "files.example.test": [publicV4] });
    const { transport } = recordingTransport(() => new Response("attachment"));

    const hydrated = await hydrateAttachments(
      { ...message, attachments: [{ filename: "a.txt", url: "https://files.example.test/a.txt" }] },
      { resolveHost, transport },
    );

    const [attachment] = hydrated.attachments ?? [];

    expect(attachment?.content).toBeInstanceOf(ArrayBuffer);
    expect(attachment?.content instanceof ArrayBuffer ? decode(attachment.content) : "").toBe(
      "attachment",
    );
  });
});

describe("pinnedLookup", () => {
  const lookupFor = pinnedLookup([publicV4, publicV6]);

  function lookupAll(family?: number | "IPv4" | "IPv6") {
    return new Promise<LookupAddress[]>((resolve, reject) => {
      lookupFor("files.example.test", { all: true, family }, (error, addresses) => {
        if (error) {
          reject(error);

          return;
        }

        resolve(Array.isArray(addresses) ? addresses : []);
      });
    });
  }

  function lookupOne(family?: number) {
    return new Promise<{ address: string; family: number }>((resolve, reject) => {
      lookupFor("files.example.test", { family }, (error, address, resolvedFamily) => {
        if (error) {
          reject(error);

          return;
        }

        resolve({ address: String(address), family: resolvedFamily ?? 0 });
      });
    });
  }

  test("answers only with the validated addresses", async () => {
    expect(await lookupAll()).toEqual([publicV4, publicV6]);
    expect(await lookupAll("IPv6")).toEqual([publicV6]);
    expect(await lookupOne()).toEqual(publicV4);
    expect(await lookupOne(6)).toEqual(publicV6);
  });

  test("fails instead of falling back to a fresh DNS answer", async () => {
    const v4Only = pinnedLookup([publicV4]);

    const outcome = new Promise<string>((resolve) => {
      v4Only("files.example.test", { family: 6 }, (error) => resolve(error?.code ?? "no error"));
    });

    expect(await outcome).toBe("ENOTFOUND");
  });
});
