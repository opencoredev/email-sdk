export type CheckStatus = "pass" | "warn" | "fail";

export type CheckFinding = {
  status: CheckStatus;
  message: string;
  fix?: string;
};

export type RecordCheck = {
  record: string | null;
  findings: CheckFinding[];
};

export type DkimSelectorResult = {
  selector: string;
  record: string | null;
};

export type DnsCheckResult = {
  domain: string;
  spf: RecordCheck;
  dmarc: RecordCheck;
  mx: { hosts: string[]; findings: CheckFinding[] };
  dkim: { selectors: DkimSelectorResult[]; findings: CheckFinding[] };
  providerHints: ProviderHint[];
  checkedAt: string;
};

export type ProviderHint = {
  name: string;
  docsPath: string;
};

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9_-]{1,63}(?<!-))+$/i;
export const SELECTOR_RE = /^[a-z0-9._-]{1,63}$/i;

// Selectors the big transactional providers actually publish, probed alongside
// any user-supplied selector.
export const COMMON_DKIM_SELECTORS = [
  "default",
  "google",
  "selector1",
  "selector2",
  "s1",
  "s2",
  "k1",
  "mg",
  "pm",
  "resend",
];

// SPF include domains → the SDK adapter docs for that provider, so a failing
// setup links straight to the relevant guide.
const SPF_INCLUDE_PROVIDERS: { match: string; name: string; docsPath: string }[] = [
  { match: "amazonses.com", name: "AWS SES", docsPath: "/docs/adapters/ses" },
  { match: "resend.com", name: "Resend", docsPath: "/docs/adapters/resend" },
  { match: "mtasv.net", name: "Postmark", docsPath: "/docs/adapters/postmark" },
  { match: "spf.mtasv.net", name: "Postmark", docsPath: "/docs/adapters/postmark" },
  { match: "sendgrid.net", name: "SendGrid", docsPath: "/docs/adapters/sendgrid" },
  { match: "mailgun.org", name: "Mailgun", docsPath: "/docs/adapters/mailgun" },
  { match: "sendinblue.com", name: "Brevo", docsPath: "/docs/adapters/brevo" },
  { match: "brevo.com", name: "Brevo", docsPath: "/docs/adapters/brevo" },
  { match: "mailersend.net", name: "MailerSend", docsPath: "/docs/adapters/mailersend" },
  { match: "sparkpostmail.com", name: "SparkPost", docsPath: "/docs/adapters/sparkpost" },
  {
    match: "mandrillapp.com",
    name: "Mailchimp Transactional",
    docsPath: "/docs/adapters/mailchimp",
  },
  { match: "zeptomail.", name: "ZeptoMail", docsPath: "/docs/adapters/zeptomail" },
  { match: "mailpace.com", name: "MailPace", docsPath: "/docs/adapters/mailpace" },
];

export function normalizeDomainInput(input: string): string | null {
  const domain = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^mailto:/, "")
    .replace(/.*@/, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/\.$/, "");
  if (!domain || domain.length > 253 || !DOMAIN_RE.test(domain)) return null;
  return domain;
}

// --- Pure parsers (unit tested) ---

export function parseSpf(txtRecords: string[]): RecordCheck {
  const spfRecords = txtRecords.filter((record) => /^v=spf1(\s|$)/i.test(record.trim()));
  const findings: CheckFinding[] = [];

  if (spfRecords.length === 0) {
    findings.push({
      status: "fail",
      message: "No SPF record found.",
      fix: 'Publish a TXT record starting with v=spf1 that lists your email provider, e.g. "v=spf1 include:amazonses.com -all".',
    });
    return { record: null, findings };
  }

  if (spfRecords.length > 1) {
    findings.push({
      status: "fail",
      message: `Found ${spfRecords.length} SPF records — receivers treat multiple SPF records as a permanent error (permerror).`,
      fix: "Merge all include: mechanisms into a single v=spf1 record.",
    });
  }

  const record = spfRecords[0].trim();
  const allMatch = record.match(/([-~+?])?all\b/i);
  if (!allMatch) {
    findings.push({
      status: "warn",
      message: "SPF record has no `all` mechanism, so it never gives receivers a final verdict.",
      fix: "End the record with ~all (soft fail) or -all (hard fail).",
    });
  } else {
    const qualifier = allMatch[1] ?? "+";
    if (qualifier === "+") {
      findings.push({
        status: "fail",
        message:
          "SPF ends with +all, which authorizes every server on the internet to send as your domain.",
        fix: "Replace +all with -all (or ~all while testing).",
      });
    } else if (qualifier === "?") {
      findings.push({
        status: "warn",
        message: "SPF ends with ?all (neutral), which gives receivers no signal.",
        fix: "Use ~all or -all once you are confident every legitimate sender is listed.",
      });
    } else {
      findings.push({
        status: "pass",
        message: `SPF record found, ending with ${qualifier}all.`,
      });
    }
  }

  // RFC 7208 caps DNS-querying mechanisms at 10; beyond that receivers permerror.
  const lookupCount = (
    record.match(/\b(include:|a\b|a:|mx\b|mx:|ptr\b|ptr:|exists:|redirect=)/gi) ?? []
  ).length;
  if (lookupCount > 10) {
    findings.push({
      status: "fail",
      message: `SPF requires ${lookupCount} DNS lookups; the limit is 10, so receivers will permerror.`,
      fix: "Flatten or remove include: entries for providers you no longer use.",
    });
  } else if (lookupCount > 7) {
    findings.push({
      status: "warn",
      message: `SPF uses ${lookupCount} of the 10 allowed DNS lookups — close to the limit.`,
    });
  }

  return { record, findings };
}

export function parseDmarc(txtRecords: string[]): RecordCheck {
  const dmarcRecords = txtRecords.filter((record) => /^v=DMARC1(\s*;|$)/i.test(record.trim()));
  const findings: CheckFinding[] = [];

  if (dmarcRecords.length === 0) {
    findings.push({
      status: "fail",
      message: "No DMARC record found at _dmarc.<domain>.",
      fix: 'Publish a TXT record at _dmarc.<domain>, e.g. "v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com" to start monitoring.',
    });
    return { record: null, findings };
  }

  const record = dmarcRecords[0].trim();
  const tags = new Map<string, string>();
  for (const part of record.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length > 0) tags.set(key.trim().toLowerCase(), rest.join("=").trim());
  }

  const policy = tags.get("p")?.toLowerCase();
  if (!policy) {
    findings.push({
      status: "fail",
      message: "DMARC record has no p= policy tag, which makes it invalid.",
      fix: "Add p=none, p=quarantine, or p=reject.",
    });
  } else if (policy === "none") {
    findings.push({
      status: "warn",
      message: "DMARC policy is p=none — you get reports, but spoofed mail is still delivered.",
      fix: "Move to p=quarantine and then p=reject once reports show only legitimate senders.",
    });
  } else {
    findings.push({ status: "pass", message: `DMARC policy is p=${policy}.` });
  }

  if (!tags.get("rua")) {
    findings.push({
      status: "warn",
      message: "No rua= reporting address — you will not receive aggregate reports.",
      fix: "Add rua=mailto:dmarc@yourdomain.com to see who sends as your domain.",
    });
  }

  const pct = tags.get("pct");
  if (pct && pct !== "100") {
    findings.push({
      status: "warn",
      message: `DMARC applies to only ${pct}% of messages (pct=${pct}).`,
      fix: "Remove pct= (defaults to 100) once you trust the policy.",
    });
  }

  return { record, findings };
}

export function parseMx(mxRecords: string[]): { hosts: string[]; findings: CheckFinding[] } {
  const hosts = mxRecords
    .map((record) => {
      const [priority, host] = record.trim().split(/\s+/);
      return { priority: Number(priority), host: (host ?? "").replace(/\.$/, "") };
    })
    .filter((entry) => entry.host)
    .sort((a, b) => a.priority - b.priority)
    .map((entry) => `${entry.priority} ${entry.host}`);

  const findings: CheckFinding[] =
    hosts.length > 0
      ? [
          {
            status: "pass",
            message: `${hosts.length} MX record${hosts.length === 1 ? "" : "s"} found.`,
          },
        ]
      : [
          {
            status: "warn",
            message:
              "No MX records — this domain cannot receive mail (replies and bounces will be lost).",
            fix: "Add MX records if you expect replies; send-only subdomains sometimes skip this deliberately.",
          },
        ];

  return { hosts, findings };
}

export function findProviderHints(spfRecord: string | null): ProviderHint[] {
  if (!spfRecord) return [];
  const hints = new Map<string, ProviderHint>();
  for (const provider of SPF_INCLUDE_PROVIDERS) {
    if (spfRecord.toLowerCase().includes(provider.match)) {
      hints.set(provider.name, { name: provider.name, docsPath: provider.docsPath });
    }
  }
  return [...hints.values()];
}
