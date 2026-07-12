import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { FullCompareTable } from "@/components/compare-table";
import { DocsVersionLink } from "@/components/docs-version-link";
import { comparePairs, getComparePairTitle } from "@/lib/compare";
import { baseOptions } from "@/lib/layout.shared";
import { appName, siteUrl } from "@/lib/shared";
import { providers } from "@/lib/providers";

const pageTitle = `Compare transactional email providers - ${appName}`;
const pageDescription =
  "Side-by-side comparisons of transactional email providers — Resend, Postmark, SendGrid, Mailgun, AWS SES, Brevo, and more — based on the message fields each API actually supports.";

export const Route = createFileRoute("/compare/")({
  head: () => ({
    meta: [
      { title: pageTitle },
      { name: "description", content: pageDescription },
      { property: "og:title", content: pageTitle },
      { property: "og:description", content: pageDescription },
      { property: "og:url", content: `${siteUrl}/compare` },
    ],
    links: [{ rel: "canonical", href: `${siteUrl}/compare` }],
  }),
  component: CompareIndex,
});

function CompareIndex() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <article className="mx-auto max-w-4xl px-6 py-14 md:px-10 lg:px-14">
          <p className="text-sm font-medium text-fd-muted-foreground">Compare</p>
          <h1 className="mt-3 text-4xl font-medium leading-tight md:text-5xl">
            Compare transactional email providers
          </h1>
          <p className="mt-5 text-base leading-7 text-fd-muted-foreground md:text-lg">
            These comparisons are generated from Email SDK&apos;s own adapter capability matrix —
            the field-support data the SDK uses to fail fast instead of silently dropping CC
            recipients, attachments, or metadata. Every provider below works behind the same typed{" "}
            <code>send()</code> call.
          </p>

          <section className="mt-10 border-t border-fd-border pt-6">
            <h2 className="text-xl font-medium">Head-to-head comparisons</h2>
            <ul className="mt-4 grid gap-2 text-sm leading-7 sm:grid-cols-2">
              {comparePairs.map((pair) => (
                <li key={pair.slug}>
                  <Link
                    className="text-fd-primary underline-offset-4 hover:underline"
                    to="/compare/$pair"
                    params={{ pair: pair.slug }}
                  >
                    {getComparePairTitle(pair)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10 border-t border-fd-border pt-6">
            <h2 className="text-xl font-medium">Full capability matrix</h2>
            <p className="mt-3 mb-4 text-sm leading-7 text-fd-muted-foreground md:text-base">
              Message-field support across all {providers.length} adapters, straight from the SDK
              source. See the{" "}
              <DocsVersionLink
                className="text-fd-primary underline-offset-4 hover:underline"
                docsPath="/docs/adapters/field-support"
                forceLatest
              >
                field support docs
              </DocsVersionLink>{" "}
              for what each field means.
            </p>
            <FullCompareTable providers={providers} />
          </section>
        </article>
      </main>
    </HomeLayout>
  );
}
