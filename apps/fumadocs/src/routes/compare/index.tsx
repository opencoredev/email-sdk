import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { FullCompareTable } from "@/components/compare-table";
import { DocsVersionLink } from "@/components/docs-version-link";
import { comparePairs, getComparePairTitle } from "@/lib/compare";
import { baseOptions } from "@/lib/layout.shared";
import { appName, siteUrl } from "@/lib/shared";
import { providers } from "@/lib/providers";

const pageTitle = "Email API Comparison: Resend, SendGrid, Postmark, Mailgun";

const pageDescription =
  "Compare Resend, SendGrid, Postmark, Mailgun, Amazon SES, Brevo and more side by side: which message fields each email API supports and what survives a switch.";

// The four providers people most often weigh together; every pair among them
// has its own page.
const bigFourSlugs = new Set([
  "resend-vs-sendgrid",
  "resend-vs-postmark",
  "resend-vs-mailgun",
  "postmark-vs-sendgrid",
  "postmark-vs-mailgun",
  "sendgrid-vs-mailgun",
]);

const bigFourPairs = comparePairs.filter((pair) => bigFourSlugs.has(pair.slug));

export const Route = createFileRoute("/compare/")({
  head: () => ({
    meta: [
      { title: pageTitle },
      { name: "description", content: pageDescription },
      { property: "og:type", content: "website" },
      { property: "og:title", content: pageTitle },
      { property: "og:description", content: pageDescription },
      { property: "og:url", content: `${siteUrl}/compare` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: pageTitle },
      { name: "twitter:description", content: pageDescription },
      {
        "script:ld+json": {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "CollectionPage",
              "@id": `${siteUrl}/compare#page`,
              url: `${siteUrl}/compare`,
              name: "Compare transactional email providers",
              description: pageDescription,
              inLanguage: "en",
              isPartOf: { "@id": `${siteUrl}/#website` },
              mainEntity: { "@id": `${siteUrl}/compare#comparisons` },
            },
            {
              "@type": "ItemList",
              "@id": `${siteUrl}/compare#comparisons`,
              name: "Head-to-head provider comparisons",
              numberOfItems: comparePairs.length,
              itemListElement: comparePairs.map((pair, index) => ({
                "@type": "ListItem",
                position: index + 1,
                name: getComparePairTitle(pair),
                url: `${siteUrl}/compare/${pair.slug}`,
              })),
            },
            {
              "@type": "BreadcrumbList",
              "@id": `${siteUrl}/compare#breadcrumb`,
              itemListElement: [
                { "@type": "ListItem", position: 1, name: appName, item: siteUrl },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: "Compare",
                  item: `${siteUrl}/compare`,
                },
              ],
            },
          ],
        },
      },
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
          <p className="mt-4 text-base leading-7 text-fd-muted-foreground md:text-lg">
            Choosing between Resend, SendGrid, Postmark, and Mailgun? Each pair has its own page:{" "}
            {bigFourPairs.map((pair, index) => (
              <span key={pair.slug}>
                {index > 0 ? (index === bigFourPairs.length - 1 ? ", and " : ", ") : null}
                <Link
                  className="text-fd-primary underline-offset-4 hover:underline"
                  to="/compare/$pair"
                  params={{ pair: pair.slug }}
                >
                  {getComparePairTitle(pair)}
                </Link>
              </span>
            ))}
            .
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
