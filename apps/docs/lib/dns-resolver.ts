// Browser-side DNS lookups for the email DNS checker. Cloudflare's and
// Google's DNS-over-HTTPS JSON APIs answer cross-origin requests, so the page
// queries them directly and needs no server route.
import { z } from "zod";

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

const dohResponseSchema = z.object({
  Status: z.number(),
  Answer: z.array(z.object({ data: z.string(), type: z.number() })).optional(),
});

type DohResponse = z.infer<typeof dohResponseSchema>;

async function fetchDohJson(url: string): Promise<DohResponse | null> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const parsed = dohResponseSchema.safeParse(await response.json());

    return parsed.success ? parsed.data : null;
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

type DkimProbe = {
  /** Selectors that published a DKIM key. */
  found: DkimSelectorResult[];
  /** Selectors whose lookup failed on every resolver, so their state is unknown. */
  unresolved: string[];
};

async function probeDkimSelectors(domain: string, userSelector?: string): Promise<DkimProbe> {
  const selectors = [
    ...new Set([...(userSelector ? [userSelector] : []), ...COMMON_DKIM_SELECTORS]),
  ];

  const results = await Promise.all(
    selectors.map(async (selector) => {
      try {
        const records = await resolveDns(`${selector}._domainkey.${domain}`, "TXT");
        const dkim = records.find((record) => /v=DKIM1|k=rsa|p=[A-Za-z0-9+/]/.test(record));

        return { kind: "resolved" as const, selector, record: dkim ?? null };
      } catch {
        return { kind: "unresolved" as const, selector };
      }
    }),
  );

  const found: DkimSelectorResult[] = [];
  const unresolved: string[] = [];

  for (const result of results) {
    if (result.kind === "unresolved") unresolved.push(result.selector);
    else if (result.record !== null)
      found.push({ selector: result.selector, record: result.record });
  }

  return { found, unresolved };
}

export function dkimFindingsFor({ found, unresolved }: DkimProbe): CheckFinding[] {
  if (found.length === 0 && unresolved.length > 0) {
    // A failed lookup is not an absent key: say the check is incomplete
    // instead of telling the user to publish records they may already have.
    return [
      {
        status: "warn",
        message: `Couldn't look up DKIM for ${unresolved.length === 1 ? "selector" : "selectors"} ${unresolved.join(", ")}, so this check is incomplete. Try again in a minute.`,
      },
    ];
  }

  if (found.length === 0) {
    return [
      {
        status: "warn",
        message:
          "No DKIM key found under the common selectors. Your provider may use a custom selector — check its dashboard and re-run with that selector.",
        fix: "Every provider issues DKIM records during domain verification; publish the CNAME/TXT records it gives you.",
      },
    ];
  }

  const plural = found.length === 1 ? "" : "s";

  return [
    {
      status: "pass",
      message: `DKIM key${plural} found for selector${plural}: ${found.map((entry) => entry.selector).join(", ")}.`,
    },
  ];
}

/** Check SPF, DMARC, MX, and common DKIM selectors for a domain. */
export async function checkEmailDns(input: string, dkimSelector?: string): Promise<DnsCheckResult> {
  const domain = normalizeDomainInput(input);

  if (!domain) throw new Error("Enter a valid domain, e.g. yourdomain.com");

  const selector =
    dkimSelector && SELECTOR_RE.test(dkimSelector.trim()) ? dkimSelector.trim() : undefined;

  const [rootTxt, dmarcTxt, mxRecords, dkimProbe] = await Promise.all([
    resolveDns(domain, "TXT"),
    resolveDns(`_dmarc.${domain}`, "TXT"),
    resolveDns(domain, "MX"),
    probeDkimSelectors(domain, selector),
  ]);

  const spf = parseSpf(rootTxt);

  return {
    domain,
    spf,
    dmarc: parseDmarc(dmarcTxt),
    mx: parseMx(mxRecords),
    dkim: { selectors: dkimProbe.found, findings: dkimFindingsFor(dkimProbe) },
    providerHints: findProviderHints(spf.record),
    checkedAt: new Date().toISOString(),
  };
}
