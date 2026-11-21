import { type SyntheticEvent, useEffect, useRef, useState } from "react";

import type { CheckFinding, DnsCheckResult } from "../lib/dns-checker";
import { checkEmailDns } from "../lib/dns-resolver";

// A shared link can carry any ?domain= value; keep it under the 253-character
// DNS name limit.
function domainFromLocation() {
  return new URLSearchParams(window.location.search).get("domain")?.slice(0, 253) ?? "";
}

function rememberDomain(domain: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("domain", domain);
  window.history.replaceState(null, "", url);
}

export function EmailDnsChecker() {
  const [domain, setDomain] = useState("");
  const [result, setResult] = useState<DnsCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const autoRan = useRef(false);

  async function runCheck(target: string) {
    setLoading(true);
    setError(null);

    try {
      const checked = await checkEmailDns(target);
      setResult(checked);
      rememberDomain(checked.domain);
    } catch (checkError) {
      setResult(null);
      setError(checkError instanceof Error ? checkError.message : "Check failed. Try again.");
    }

    setLoading(false);
  }

  // Check a shared ?domain= link once on mount.
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;

    const shared = domainFromLocation();

    if (shared) {
      setDomain(shared);
      void runCheck(shared);
    }
  }, []);

  function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    if (domain.trim()) void runCheck(domain);
  }

  return (
    <div className="not-prose my-6">
      <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
        <input
          aria-label="Domain to check"
          autoComplete="off"
          className="w-full border border-fd-border bg-fd-card px-4 py-2.5 text-sm text-fd-foreground outline-none focus:border-fd-primary"
          inputMode="url"
          onChange={(event) => setDomain(event.target.value)}
          placeholder="yourdomain.com"
          spellCheck={false}
          value={domain}
        />
        <button
          className="shrink-0 bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground disabled:opacity-50"
          disabled={loading || !domain.trim()}
          type="submit"
        >
          {loading ? "Checking…" : "Check DNS"}
        </button>
      </form>

      {error && (
        <p
          className="mt-4 border border-fd-border bg-fd-muted px-4 py-3 text-sm text-fd-foreground"
          role="alert"
        >
          {error}
        </p>
      )}

      {result && <CheckResults result={result} />}
    </div>
  );
}

function CheckResults({ result }: { result: DnsCheckResult }) {
  return (
    <div aria-live="polite" className="mt-8 space-y-6">
      <ResultSection findings={result.spf.findings} record={result.spf.record} title="SPF" />
      <ResultSection findings={result.dmarc.findings} record={result.dmarc.record} title="DMARC" />
      <ResultSection
        findings={result.dkim.findings}
        record={
          result.dkim.selectors.length > 0
            ? result.dkim.selectors.map((entry) => entry.selector).join(", ")
            : null
        }
        recordLabel="Selectors"
        title="DKIM"
      />
      <ResultSection
        findings={result.mx.findings}
        record={result.mx.hosts.join(", ") || null}
        recordLabel="Hosts"
        title="MX"
      />

      {result.providerHints.length > 0 && (
        <div className="border border-fd-border p-4 text-sm leading-7">
          <p className="font-medium text-fd-foreground">Providers detected in your SPF record</p>
          <ul className="mt-2 list-disc pl-5 text-fd-muted-foreground">
            {result.providerHints.map((hint) => (
              <li key={hint.name}>
                <a
                  className="text-fd-primary underline-offset-4 hover:underline"
                  href={hint.docsPath}
                >
                  {hint.name} adapter guide
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ResultSection({
  findings,
  record,
  recordLabel = "Record",
  title,
}: {
  findings: CheckFinding[];
  record: string | null;
  recordLabel?: string;
  title: string;
}) {
  return (
    <section className="border border-fd-border p-4">
      <h3 className="text-lg font-medium text-fd-foreground">{title}</h3>
      {record && (
        <p className="mt-2 break-all bg-fd-muted px-3 py-2 font-mono text-xs leading-5 text-fd-muted-foreground">
          <span className="font-sans font-medium text-fd-foreground">{recordLabel}: </span>
          {record}
        </p>
      )}
      <ul className="mt-3 space-y-2 text-sm leading-6 text-fd-foreground">
        {findings.map((finding) => (
          <li key={finding.message} className="flex gap-2">
            <StatusBadge status={finding.status} />
            <span>
              {finding.message}
              {finding.fix && <span className="block text-fd-muted-foreground">{finding.fix}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const statusStyles = {
  pass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  fail: "bg-red-500/15 text-red-700 dark:text-red-400",
} as const;

function StatusBadge({ status }: { status: CheckFinding["status"] }) {
  return (
    <span
      className={`mt-0.5 h-fit shrink-0 px-1.5 py-0.5 text-[11px] font-semibold uppercase ${statusStyles[status]}`}
    >
      {status}
    </span>
  );
}
