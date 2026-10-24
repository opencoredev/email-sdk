import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";

import { ses } from "./ses.js";
import { stubFetch } from "../test-support/fetch.js";
import { context, messageWithoutMetadata } from "../test-support/adapter-fixtures.js";

type SignedRequest = { url: string; headers: Headers; body: string };

function capture() {
  const requests: SignedRequest[] = [];

  const fetch = stubFetch(async (input, init) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: String(init?.body),
    });

    return new Response('{"MessageId":"ses_1"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  return { requests, fetch };
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const hmac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value).digest();

/** SigV4 written straight from the AWS spec with node:crypto, independent of the adapter. */
function expectedAuthorization(request: SignedRequest, secret: string, region: string) {
  const url = new URL(request.url);
  const amzDate = request.headers.get("x-amz-date") ?? "";
  const dateStamp = amzDate.slice(0, 8);

  const signed = [...request.headers.entries(), ["host", url.host]]
    .flatMap(([name = "", value = ""]) =>
      name === "authorization" ? [] : [[name.toLowerCase(), value.trim()]],
    )
    .sort(([left = ""], [right = ""]) => (left < right ? -1 : left > right ? 1 : 0));

  const signedHeaders = signed.map(([name]) => name).join(";");

  const canonicalRequest = [
    "POST",
    url.pathname,
    "",
    signed.map(([name, value]) => `${name}:${value}\n`).join(""),
    signedHeaders,
    sha256(request.body),
  ].join("\n");

  const scope = `${dateStamp}/${region}/ses/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), "ses"), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");

  return `AWS4-HMAC-SHA256 Credential=AKID/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

afterEach(() => {
  setSystemTime();
});

describe("SES SigV4 signing", () => {
  test("matches an independent SigV4 signature, including after the UTC date changes", async () => {
    const { requests, fetch } = capture();

    const adapter = ses({
      accessKeyId: "AKID",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      sessionToken: "session-token",
      region: "eu-west-1",
      fetch,
    });

    setSystemTime(new Date("2026-03-01T23:59:58.000Z"));
    await adapter.send(messageWithoutMetadata, context);
    await adapter.send(messageWithoutMetadata, context);
    setSystemTime(new Date("2026-03-02T00:00:01.000Z"));
    await adapter.send(messageWithoutMetadata, context);

    expect(requests.map((request) => request.headers.get("x-amz-date"))).toEqual([
      "20260301T235958Z",
      "20260301T235958Z",
      "20260302T000001Z",
    ]);

    for (const request of requests) {
      expect(request.headers.get("x-amz-content-sha256")).toBe(sha256(request.body));
      expect(request.headers.get("authorization")).toBe(
        expectedAuthorization(request, "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "eu-west-1"),
      );
    }
  });
});
