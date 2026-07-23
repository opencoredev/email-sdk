import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { DocsVersionLink } from "@/components/docs-version-link";
import type { CheckFinding, DnsCheckResult } from "@/lib/dns-checker";
import { checkEmailDnsServerFn } from "@/lib/dns-checker-runtime";
import { baseOptions } from "@/lib/layout.shared";
import { appName, siteUrl } from "@/lib/shared";

const pageTitle = `Free Email DNS Checker — SPF, DKIM & DMARC Lookup - ${appName}`;
const pageDescription =
  "Check any domain's email DNS setup in seconds: SPF record validation, DKIM selector lookup, DMARC policy check, and MX records — free, no signup, with fixes explained.";
const canonicalUrl = `${siteUrl}/tools/email-dns-checker`;

type CheckerSearch = { domain?: string };

export const Route = createFileRoute("/tools/email-dns-checker")({
  validateSearch: (search: Record<string, unknown>): CheckerSearch => ({
    domain: typeof search.domain === "string" ? search.domain.slice(0, 253) : undefined,
  }),
  head: () => ({
    meta: [
      { title: pageTitle },
      { name: "description", content: pageDescription },
      { property: "og:title", content: pageTitle },
      { property: "og:description", content: pageDescription },
      { property: "og:url", content: canonicalUrl },
      {
        "script:ld+json": {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Email DNS Checker",
          applicationCategory: "DeveloperApplication",
          operatingSystem: "Any",
          url: canonicalUrl,
          description: pageDescription,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          publisher: { "@id": `${siteUrl}/#organization` },
        },
      },
    ],
    // Always canonicalize to the bare tool URL: ?domain= result views are
    // shareable but must not be indexed as separate pages.
    links: [{ rel: "canonical", href: canonicalUrl }],
  }),
  component: DnsCheckerPage,
});

function DnsCheckerPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [domain, setDomain] = useState(search.domain ?? "");
  const [result, setResult] = useState<DnsCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const autoRan = useRef(false);

  async function runCheck(target: string) {
    setLoading(true);
    setError(null);
    try {
      const checked = await checkEmailDnsServerFn({ data: { domain: target } });
      setResult(checked);
      void navigate({ search: { domain: checked.domain }, replace: true });
    } catch (checkError) {
      setResult(null);
      setError(checkError instanceof Error ? checkError.message : "Check failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (search.domain && !autoRan.current) {
      autoRan.current = true;
      void runCheck(search.domain);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (domain.trim()) void runCheck(domain);
  }

  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <article className="mx-auto max-w-3xl px-6 py-14 md:px-10 lg:px-14">
          <p className="text-sm font-medium text-fd-muted-foreground">
            <Link className="hover:underline" to="/tools">
              Free tools
            </Link>
          </p>
          <h1 className="mt-3 text-4xl font-medium leading-tight md:text-5xl">Email DNS checker</h1>
          <p className="mt-5 text-base leading-7 text-fd-muted-foreground md:text-lg">
            Check a domain&apos;s SPF, DKIM, DMARC, and MX records in one pass. Free, no signup —
            results explain what each record means and how to fix what&apos;s missing.
          </p>

          <form className="mt-8 flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
            <input
              aria-label="Domain to check"
              autoComplete="off"
              className="w-full rounded-lg border border-fd-border bg-fd-secondary/30 px-4 py-2.5 text-sm outline-none focus:border-fd-primary"
              inputMode="url"
              onChange={(event) => setDomain(event.target.value)}
              placeholder="yourdomain.com"
              spellCheck={false}
              value={domain}
            />
            <button
              className="shrink-0 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground disabled:opacity-50"
              disabled={loading || !domain.trim()}
              type="submit"
            >
              {loading ? "Checking…" : "Check DNS"}
            </button>
          </form>

          {error && (
            <p className="mt-4 rounded-lg border border-fd-border bg-fd-secondary/40 px-4 py-3 text-sm text-fd-foreground">
              {error}
            </p>
          )}

          {result && <CheckResults result={result} />}

          <div className="mt-14 space-y-9 text-sm leading-7 text-fd-muted-foreground md:text-base">
            <ExplainerSection title="What this tool checks">
              Receiving mail servers decide whether to trust your email based on three DNS records.{" "}
              <strong className="text-fd-foreground">SPF</strong> (a TXT record starting with{" "}
              <code>v=spf1</code>) lists the servers allowed to send mail as your domain.{" "}
              <strong className="text-fd-foreground">DKIM</strong> (a TXT record under{" "}
              <code>&lt;selector&gt;._domainkey.yourdomain.com</code>) publishes a public key that
              lets receivers verify each message was signed by you and not altered in transit.{" "}
              <strong className="text-fd-foreground">DMARC</strong> (a TXT record at{" "}
              <code>_dmarc.yourdomain.com</code>) ties the two together: it tells receivers what to
              do with mail that fails SPF and DKIM, and where to send reports. MX records are
              checked too, since a domain that cannot receive replies or bounces loses signal with
              mailbox providers.
            </ExplainerSection>

            <ExplainerSection title="How to read the results">
              A <strong className="text-fd-foreground">pass</strong> means the record exists and
              follows current best practice. A <strong className="text-fd-foreground">warn</strong>{" "}
              usually means mail still flows but you are leaving deliverability or security on the
              table — a DMARC policy of <code>p=none</code>, for example, monitors spoofing without
              stopping it. A <strong className="text-fd-foreground">fail</strong> is worth fixing
              before your next campaign: multiple SPF records or a record ending in{" "}
              <code>+all</code> can cause receivers to reject or junk otherwise legitimate mail.
              DKIM selectors are provider-specific, so if the probe finds nothing under the common
              selectors, check your provider&apos;s dashboard for the exact selector name and DNS
              records it issued during domain verification.
            </ExplainerSection>

            <ExplainerSection title="Setting up DNS for your provider">
              Every transactional email provider — Resend, Postmark, SendGrid, AWS SES, Mailgun,
              Brevo, and the rest — walks you through publishing SPF and DKIM records when you
              verify a sending domain. The{" "}
              <DocsVersionLink
                className="text-fd-primary underline-offset-4 hover:underline"
                docsPath="/docs/adapters"
                forceLatest
              >
                Email SDK adapter guides
              </DocsVersionLink>{" "}
              cover setup and verification for each provider, and the{" "}
              <DocsVersionLink
                className="text-fd-primary underline-offset-4 hover:underline"
                docsPath="/docs/authentication"
                forceLatest
              >
                authentication docs
              </DocsVersionLink>{" "}
              cover credentials. If you send through more than one provider (for example a{" "}
              <Link
                className="text-fd-primary underline-offset-4 hover:underline"
                to="/compare/$pair"
                params={{ pair: "resend-vs-postmark" }}
              >
                primary plus a fallback
              </Link>
              ), each provider needs its own DKIM records, and your SPF record must include all of
              them — while staying under SPF&apos;s 10-DNS-lookup limit, which this tool checks.
            </ExplainerSection>
          </div>
        </article>
      </main>
    </HomeLayout>
  );
}

function CheckResults({ result }: { result: DnsCheckResult }) {
  return (
    <div className="mt-8 space-y-6">
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
        <div className="rounded-lg border border-fd-border p-4 text-sm leading-7">
          <p className="font-medium">Providers detected in your SPF record</p>
          <ul className="mt-2 list-disc pl-5 text-fd-muted-foreground">
            {result.providerHints.map((hint) => (
              <li key={hint.name}>
                <DocsVersionLink
                  className="text-fd-primary underline-offset-4 hover:underline"
                  docsPath={hint.docsPath}
                  forceLatest
                >
                  {hint.name} adapter guide
                </DocsVersionLink>
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
    <section className="rounded-lg border border-fd-border p-4">
      <h2 className="text-lg font-medium">{title}</h2>
      {record && (
        <p className="mt-2 break-all rounded bg-fd-secondary/50 px-3 py-2 font-mono text-xs leading-5 text-fd-muted-foreground">
          <span className="font-sans font-medium text-fd-foreground">{recordLabel}: </span>
          {record}
        </p>
      )}
      <ul className="mt-3 space-y-2 text-sm leading-6">
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

function StatusBadge({ status }: { status: CheckFinding["status"] }) {
  const styles = {
    pass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    fail: "bg-red-500/15 text-red-600 dark:text-red-400",
  } as const;
  return (
    <span
      className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function ExplainerSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="border-t border-fd-border pt-6">
      <h2 className="text-xl font-medium text-fd-foreground">{title}</h2>
      <p className="mt-3">{children}</p>
    </section>
  );
}
