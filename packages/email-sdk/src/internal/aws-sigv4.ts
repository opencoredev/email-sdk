export interface AwsCredentialScope {
  secretAccessKey: string;
  region: string;
  service: string;
}

export interface AwsSignatureInput extends AwsCredentialScope {
  accessKeyId: string;
  sessionToken?: string;
  method: string;
  url: URL;
  body: string;
  headers: Record<string, string>;
}

interface CachedSigningKey extends AwsCredentialScope {
  dateStamp: string;
  key: Promise<CryptoKey>;
}

/**
 * The derived SigV4 signing key depends only on the secret, UTC date, region, and service, so
 * it is reused while all four stay the same instead of running four HMAC rounds per request.
 * A rotated secret or a new day derives a fresh key. Credentials themselves are never cached:
 * callers pass them on every request.
 */
export function createSigningKeyCache() {
  let cached: CachedSigningKey | undefined;

  return (scope: AwsCredentialScope, dateStamp: string) => {
    if (
      cached?.dateStamp === dateStamp &&
      cached.secretAccessKey === scope.secretAccessKey &&
      cached.region === scope.region &&
      cached.service === scope.service
    ) {
      return cached.key;
    }

    const key = deriveSigningKey(scope, dateStamp);

    const entry: CachedSigningKey = {
      secretAccessKey: scope.secretAccessKey,
      region: scope.region,
      service: scope.service,
      dateStamp,
      key,
    };

    cached = entry;
    // A failed derivation must not poison later requests.
    key.catch(() => {
      if (cached === entry) cached = undefined;
    });

    return key;
  };
}

export type SigningKeyCache = ReturnType<typeof createSigningKeyCache>;

// Spread after the caller's headers, so these exact keys always hold the signer's own values.
const COMPUTED_HEADERS = new Set(["host", "x-amz-content-sha256", "x-amz-date"]);

/** Sign a request with AWS Signature Version 4, reusing a derived key from `signingKeys`. */
export async function signAwsRequest(signingKeys: SigningKeyCache, input: AwsSignatureInput) {
  const amzDate = toAmzDate(new Date());
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
    // SigV4 trims each value and collapses sequential whitespace into one space, quoted or not,
    // as the AWS SDKs do. `\s+` has no nested quantifier, so the replace stays linear. The values
    // computed here hold no whitespace, so they skip it.
    .map(([name, value]) =>
      [name.toLowerCase(), COMPUTED_HEADERS.has(name) ? value : value.trim().replace(/\s+/g, " ")] as const,
    )
    // SigV4 orders headers by character code, not by locale.
    .sort(([left], [right]) => compareCodeUnits(left, right));

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

  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKeys(input, dateStamp),
    textBytes(stringToSign),
  );

  return {
    ...requestHeaders,
    Authorization: [
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${bytesToHex(new Uint8Array(signature))}`,
    ].join(", "),
  };
}

async function deriveSigningKey(scope: AwsCredentialScope, dateStamp: string) {
  const dateKey = await hmac(textBytes(`AWS4${scope.secretAccessKey}`), dateStamp);
  const regionKey = await hmac(dateKey, scope.region);
  const serviceKey = await hmac(regionKey, scope.service);
  const signingKey = await hmac(serviceKey, "aws4_request");

  return importHmacKey(signingKey);
}

function compareCodeUnits(left: string, right: string) {
  if (left === right) return 0;

  return left < right ? -1 : 1;
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textBytes(value));

  return bytesToHex(new Uint8Array(digest));
}

function canonicalQueryString(searchParams: URLSearchParams) {
  if (searchParams.size === 0) return "";

  return [...searchParams.entries()]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyOrder = compareCodeUnits(leftKey, rightKey);

      return keyOrder === 0 ? compareCodeUnits(leftValue, rightValue) : keyOrder;
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

function importHmacKey(key: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function hmac(key: Uint8Array<ArrayBuffer>, value: string) {
  const signature = await crypto.subtle.sign("HMAC", await importHmacKey(key), textBytes(value));

  return new Uint8Array(signature);
}

const encoder = new TextEncoder();

function textBytes(value: string) {
  return encoder.encode(value);
}

const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, "0"));

function bytesToHex(bytes: Uint8Array) {
  let hex = "";

  for (const byte of bytes) hex += HEX[byte];

  return hex;
}
