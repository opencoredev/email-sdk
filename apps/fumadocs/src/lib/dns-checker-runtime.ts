import { createServerFn } from "@tanstack/react-start";

import {
  type CheckFinding,
  COMMON_DKIM_SELECTORS,
  type DkimSelectorResult,
  type DnsCheckResult,
  findProviderHints,
  normalizeDomainInput,
  parseDmarc,
  parseMx,
  parseSpf,
  SELECTOR_RE,
} from "./dns-checker";

// --- DNS-over-HTTPS resolution ---

type DohAnswer = { data: string; type: number };

async function fetchDohJson(url: string): Promise<{ Status: number; Answer?: DohAnswer[] } | null> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return (await response.json()) as { Status: number; Answer?: DohAnswer[] };
  } catch {
    return null;
  }
}

async function resolveDns(name: string, type: "TXT" | "MX"): Promise<string[]> {
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
  ];
  for (const endpoint of endpoints) {
    const result = await fetchDohJson(endpoint);
    if (!result) continue;
    if (result.Answer) {
      const wantedType = type === "TXT" ? 16 : 15;
      return result.Answer.filter((answer) => answer.type === wantedType).map((answer) =>
        // TXT strings come back quoted and possibly split into chunks.
        answer.data.replace(/^"|"$/g, "").replaceAll('" "', ""),
      );
    }
    // NOERROR/NXDOMAIN without answers is an authoritative empty result.
    if (result.Status === 0 || result.Status === 3) return [];
  }
  throw new Error("DNS resolution is temporarily unavailable. Try again in a minute.");
}

async function probeDkimSelectors(domain: string, userSelector?: string) {
  const selectors = [
    ...new Set([...(userSelector ? [userSelector] : []), ...COMMON_DKIM_SELECTORS]),
  ];
  const results = await Promise.all(
    selectors.map(async (selector): Promise<DkimSelectorResult> => {
      try {
        const records = await resolveDns(`${selector}._domainkey.${domain}`, "TXT");
        const dkim = records.find((record) => /v=DKIM1|k=rsa|p=[A-Za-z0-9+/]/.test(record));
        return { selector, record: dkim ?? null };
      } catch {
        return { selector, record: null };
      }
    }),
  );
  return results.filter((result) => result.record !== null);
}

// --- Rate limiting: per-instance sliding window. Good enough for a free tool;
// the DoH endpoints we proxy are public and unauthenticated anyway. ---

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
let recentChecks: number[] = [];

function assertRateLimit() {
  const now = Date.now();
  recentChecks = recentChecks.filter((time) => now - time < RATE_WINDOW_MS);
  if (recentChecks.length >= RATE_LIMIT) {
    throw new Error("Too many checks right now — please try again in a minute.");
  }
  recentChecks.push(now);
}

// Short-lived per-domain cache so repeat checks of the same domain (or shared
// result links) don't re-query DNS.
const resultCache = new Map<string, { result: DnsCheckResult; expires: number }>();
const CACHE_TTL_MS = 60_000;

export const checkEmailDnsServerFn = createServerFn({ method: "GET" })
  .inputValidator((input: { domain: string; dkimSelector?: string }) => {
    const domain = normalizeDomainInput(input.domain);
    if (!domain) throw new Error("Enter a valid domain, e.g. yourdomain.com");
    const dkimSelector =
      input.dkimSelector && SELECTOR_RE.test(input.dkimSelector.trim())
        ? input.dkimSelector.trim()
        : undefined;
    return { domain, dkimSelector };
  })
  .handler(async ({ data }): Promise<DnsCheckResult> => {
    const cacheKey = `${data.domain}:${data.dkimSelector ?? ""}`;
    const cached = resultCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.result;

    assertRateLimit();

    const [rootTxt, dmarcTxt, mxRecords, dkimSelectors] = await Promise.all([
      resolveDns(data.domain, "TXT"),
      resolveDns(`_dmarc.${data.domain}`, "TXT"),
      resolveDns(data.domain, "MX"),
      probeDkimSelectors(data.domain, data.dkimSelector),
    ]);

    const spf = parseSpf(rootTxt);
    const dkimFindings: CheckFinding[] =
      dkimSelectors.length > 0
        ? [
            {
              status: "pass",
              message: `DKIM key${dkimSelectors.length === 1 ? "" : "s"} found for selector${
                dkimSelectors.length === 1 ? "" : "s"
              }: ${dkimSelectors.map((entry) => entry.selector).join(", ")}.`,
            },
          ]
        : [
            {
              status: "warn",
              message:
                "No DKIM key found under the common selectors. Your provider may use a custom selector — check its dashboard and re-run with that selector.",
              fix: "Every provider issues DKIM records during domain verification; publish the CNAME/TXT records it gives you.",
            },
          ];

    const result: DnsCheckResult = {
      domain: data.domain,
      spf,
      dmarc: parseDmarc(dmarcTxt),
      mx: parseMx(mxRecords),
      dkim: { selectors: dkimSelectors, findings: dkimFindings },
      providerHints: findProviderHints(spf.record),
      checkedAt: new Date().toISOString(),
    };

    resultCache.set(cacheKey, { result, expires: Date.now() + CACHE_TTL_MS });
    if (resultCache.size > 500) {
      const oldest = resultCache.keys().next().value;
      if (oldest) resultCache.delete(oldest);
    }
    return result;
  });
