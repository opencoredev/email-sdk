import { describe, expect, test } from "bun:test";

import { DEFAULT_INBOUND_MAX_BODY_BYTES, InboundError, handleInbound } from "./inbound.js";

const encoder = new TextEncoder();

const postmarkBody = JSON.stringify({
  MessageID: "pm-1",
  Subject: "Hi",
  Headers: [],
  Attachments: [],
});

const open = { provider: "postmark", auth: { none: true } } as const;

function post(body: BodyInit, headers: HeadersInit = {}) {
  return new Request("https://example.test/inbound", { method: "POST", body, headers });
}

/** A chunked body with no Content-Length that counts how much of it was pulled. */
function streamingRequest(chunks: number, chunkBytes: number) {
  let pulled = 0;
  let cancelled = false;

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled === chunks) {
        controller.close();

        return;
      }

      pulled += 1;
      controller.enqueue(new Uint8Array(chunkBytes));
    },
    cancel() {
      cancelled = true;
    },
  });

  return {
    request: new Request("https://example.test/inbound", { method: "POST", body, duplex: "half" }),
    pulled: () => pulled,
    cancelled: () => cancelled,
  };
}

describe("handleInbound maxBodyBytes", () => {
  test("the default is 50 MiB", () => {
    expect(DEFAULT_INBOUND_MAX_BODY_BYTES).toBe(50 * 1024 * 1024);
  });

  test("a body within the limit is read, verified, and parsed as before", async () => {
    const result = await handleInbound(post(postmarkBody), {
      ...open,
      maxBodyBytes: encoder.encode(postmarkBody).byteLength,
    });

    expect(result.type === "emails" && result.emails[0]?.id).toBe("pm-1");
  });

  test("a declared Content-Length over the limit is refused before the body is read", async () => {
    const request = post(postmarkBody, { "content-length": "1000" });

    const error = await handleInbound(request, { ...open, maxBodyBytes: 100 }).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(InboundError);
    expect(error).toMatchObject({ reason: "payload_too_large", provider: "postmark" });
    expect(request.bodyUsed).toBe(false);
  });

  test("a chunked body without Content-Length is cancelled once it passes the limit", async () => {
    const stream = streamingRequest(1000, 1024);

    await expect(
      handleInbound(stream.request, { ...open, maxBodyBytes: 4096 }),
    ).rejects.toMatchObject({
      reason: "payload_too_large",
    });

    // Stops after the chunk that crossed 4 KiB instead of buffering the full 1 MiB.
    expect(stream.pulled()).toBeLessThan(10);
    expect(stream.cancelled()).toBe(true);
  });

  test("an oversized cloned request rejects immediately even when the original branch is never read", async () => {
    const stream = streamingRequest(100, 1024);
    const cloned = stream.request.clone();

    const started = Date.now();

    await expect(
      handleInbound(cloned, { ...open, maxBodyBytes: 2048 }),
    ).rejects.toMatchObject({ reason: "payload_too_large" });

    expect(Date.now() - started).toBeLessThan(1_000);
    await stream.request.body?.cancel();
  });

  test("a Content-Length that understates the body does not get past the stream count", async () => {
    const oversized = JSON.stringify({ ...JSON.parse(postmarkBody), TextBody: "x".repeat(5000) });

    const request = new Request("https://example.test/inbound", {
      method: "POST",
      body: oversized,
    });

    // Some runtimes pass a client's Content-Length through unchecked; simulate one that lies.
    const lying = new Request(request, { headers: { "content-length": "10" } });

    await expect(handleInbound(lying, { ...open, maxBodyBytes: 1000 })).rejects.toMatchObject({
      reason: "payload_too_large",
    });
  });

  test("the signature check still runs after a body within the limit", async () => {
    await expect(
      handleInbound(post(postmarkBody), {
        provider: "postmark",
        auth: { basic: { username: "u", password: "p" } },
        maxBodyBytes: 10_000,
      }),
    ).rejects.toMatchObject({ reason: "signature_missing" });
  });

  test("Infinity disables the limit and invalid limits are rejected", async () => {
    expect(
      (await handleInbound(post(postmarkBody), { ...open, maxBodyBytes: Infinity })).type,
    ).toBe("emails");

    for (const maxBodyBytes of [0, -1, Number.NaN]) {
      await expect(handleInbound(post(postmarkBody), { ...open, maxBodyBytes })).rejects.toThrow(
        RangeError,
      );
    }
  });
});
