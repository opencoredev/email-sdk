import { isStringMember } from "./decode.js";

export interface AwsSignatureInput {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service: string;
  method: string;
  url: URL;
  body: string;
  headers: Record<string, string>;
}

/** Sign a request with AWS Signature Version 4. */
export async function signAwsRequest(input: AwsSignatureInput) {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(input.body);

  const sessionTokenHeaders = input.sessionToken
    ? { "x-amz-security-token": input.sessionToken }
    : undefined;

  const requestHeaders = {
    ...input.headers,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...sessionTokenHeaders,
  };

  const canonicalHeaders = Object.entries({
    ...requestHeaders,
    host: input.url.host,
  })
    .map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right));

  const signedHeaders = canonicalHeaders.map(([name]) => name).join(";");
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;

  const canonicalRequest = [
    input.method,
    input.url.pathname,
    canonicalQueryString(input.url.searchParams),
    canonicalHeaders.map(([name, value]) => `${name}:${value}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSigningKey(
    input.secretAccessKey,
    dateStamp,
    input.region,
    input.service,
  );

  const signature = await hmacHex(signingKey, stringToSign);

  return {
    ...requestHeaders,
    Authorization: [
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", "),
  };
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textBytes(value));

  return bytesToHex(new Uint8Array(digest));
}

function canonicalQueryString(searchParams: URLSearchParams) {
  return [...searchParams.entries()]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyOrder = leftKey.localeCompare(rightKey);

      return keyOrder === 0 ? leftValue.localeCompare(rightValue) : keyOrder;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function hmac(key: string | Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    isStringMember(key) ? textBytes(key) : toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, textBytes(value));

  return new Uint8Array(signature);
}

async function hmacHex(key: string | Uint8Array, value: string) {
  return bytesToHex(await hmac(key, value));
}

async function getSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
) {
  const dateKey = await hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, service);

  return hmac(serviceKey, "aws4_request");
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy.buffer;
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
