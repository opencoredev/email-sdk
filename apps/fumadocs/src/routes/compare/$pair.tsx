import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

import { CompareTable } from "@/components/compare-table";
import { DocsVersionLink } from "@/components/docs-version-link";
import {
  type ComparePair,
  getAdapterConfigSnippet,
  getComparePair,
  getComparePairTitle,
  getFallbackGaps,
  getProvider,
  messageFieldLabels,
  type ProviderKey,
} from "@/lib/compare";
import { baseOptions } from "@/lib/layout.shared";
import { appName, siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/compare/$pair")({
  head: ({ params }) => {
    const pair = getComparePair(params.pair);
    if (!pair) return {};

    const title = getComparePairTitle(pair);
    const pageTitle = `${title}: transactional email API comparison - ${appName}`;
    const description = buildDescription(pair);
    const canonicalUrl = `${siteUrl}/compare/${pair.slug}`;

    return {
      meta: [
        { title: pageTitle },
        { name: "description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:title", content: pageTitle },
        { property: "og:description", content: description },
        { property: "og:url", content: canonicalUrl },
        {
          "script:ld+json": {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: buildFaq(pair).map((entry) => ({
              "@type": "Question",
              name: entry.question,
              acceptedAnswer: { "@type": "Answer", text: entry.answer },
            })),
          },
        },
      ],
      links: [{ rel: "canonical", href: canonicalUrl }],
    };
  },
  loader: ({ params }) => {
    // Only curated pairs render; arbitrary slugs must 404, not produce thin pages.
    if (!getComparePair(params.pair)) throw notFound();
  },
  component: ComparePage,
});

function buildDescription(pair: ComparePair) {
  const a = getProvider(pair.a);
  const b = getProvider(pair.b);
  return `${a.name} vs ${b.name} for transactional email: message-field support compared side by side (attachments, scheduling, metadata, and more), with code for both via one TypeScript SDK.`;
}

function buildFaq(pair: ComparePair) {
  const a = getProvider(pair.a);
  const b = getProvider(pair.b);
  const gapsAtoB = getFallbackGaps(pair.a, pair.b);
  const gapsBtoA = getFallbackGaps(pair.b, pair.a);

  const gapAnswer =
    gapsAtoB.length > 0
      ? `${a.name} supports ${listFields(gapsAtoB)} in the unified message shape, which ${b.name} does not.`
      : `${b.name} supports every message field that ${a.name} supports, so nothing is lost moving a message from ${a.name} to ${b.name}.`;

  const fallbackAnswer =
    gapsBtoA.length === 0 && gapsAtoB.length === 0
      ? `Yes — ${a.name} and ${b.name} support the same message fields, so Email SDK can fail over between them in either direction without dropping data.`
      : `Partially. Email SDK checks field support before every send: a fallback from ${a.name} to ${b.name} is rejected for messages using ${
          gapsAtoB.length > 0 ? listFields(gapsAtoB) : "no fields"
        }${
          gapsBtoA.length > 0
            ? `, and from ${b.name} to ${a.name} for messages using ${listFields(gapsBtoA)}`
            : ""
        }. Messages that avoid those fields fail over cleanly.`;

  return [
    {
      question: `Can I switch from ${a.name} to ${b.name} without rewriting my email code?`,
      answer: `Yes. With Email SDK both providers share one typed send() call and one message shape, so switching from ${a.name} to ${b.name} is a one-line adapter change plus an API key. The SDK fails fast if a message uses a field ${b.name} does not support, so nothing is silently dropped.`,
    },
    {
      question: `Which message fields does ${a.name} support that ${b.name} doesn't?`,
      answer: gapAnswer,
    },
    {
      question: `Can I use ${b.name} as a fallback for ${a.name}?`,
      answer: fallbackAnswer,
    },
  ];
}

function listFields(fields: ReturnType<typeof getFallbackGaps>) {
  return fields.map((field) => messageFieldLabels[field].toLowerCase()).join(", ");
}

function ComparePage() {
  const { pair: slug } = Route.useParams();
  const pair = getComparePair(slug);
  if (!pair) return null;

  const a = getProvider(pair.a);
  const b = getProvider(pair.b);
  const title = getComparePairTitle(pair);
  const gapsAtoB = getFallbackGaps(pair.a, pair.b);
  const gapsBtoA = getFallbackGaps(pair.b, pair.a);
  const faq = buildFaq(pair);

  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <article className="mx-auto max-w-3xl px-6 py-14 md:px-10 lg:px-14">
          <p className="text-sm font-medium text-fd-muted-foreground">
            <Link className="hover:underline" to="/compare">
              Compare providers
            </Link>
          </p>
          <h1 className="mt-3 text-4xl font-medium leading-tight md:text-5xl">{title}</h1>
          <p className="mt-5 text-base leading-7 text-fd-muted-foreground md:text-lg">
            {pair.intro}
          </p>

          <div className="mt-10 space-y-10 text-sm leading-7 text-fd-muted-foreground md:text-base">
            <CompareSection title="Message field support">
              <p className="mb-4">
                Field support as encoded in Email SDK&apos;s own adapter capability matrix — the
                same data the SDK uses to reject sends that would silently drop fields.
              </p>
              <CompareTable
                columns={[
                  { key: pair.a, name: a.name },
                  { key: pair.b, name: b.name },
                ]}
              />
            </CompareSection>

            <CompareSection title="Fallback compatibility">
              {gapsAtoB.length === 0 && gapsBtoA.length === 0 ? (
                <p>
                  {a.name} and {b.name} support identical message fields, so Email SDK can fail over
                  between them in either direction without losing data.
                </p>
              ) : (
                <>
                  {gapsAtoB.length > 0 && (
                    <p>
                      Failing over from <strong>{a.name}</strong> to <strong>{b.name}</strong>{" "}
                      loses: {listFields(gapsAtoB)}. Email SDK rejects the fallback send for
                      messages that use these fields instead of dropping them silently.
                    </p>
                  )}
                  {gapsBtoA.length > 0 && (
                    <p className={gapsAtoB.length > 0 ? "mt-3" : undefined}>
                      Failing over from <strong>{b.name}</strong> to <strong>{a.name}</strong>{" "}
                      loses: {listFields(gapsBtoA)}.
                    </p>
                  )}
                </>
              )}
            </CompareSection>

            <CompareSection title="Same code, either provider">
              <p className="mb-4">
                With Email SDK the send call is identical for both providers — only the adapter
                import changes:
              </p>
              <CodeBlock>{sendSnippet(pair.a, a.importPath)}</CodeBlock>
              <p className="my-4">Or run both, with automatic fallback:</p>
              <CodeBlock>{fallbackSnippet(pair, a.importPath, b.importPath)}</CodeBlock>
            </CompareSection>

            <CompareSection title="FAQ">
              <dl className="space-y-6">
                {faq.map((entry) => (
                  <div key={entry.question}>
                    <dt className="font-medium text-fd-foreground">{entry.question}</dt>
                    <dd className="mt-2">{entry.answer}</dd>
                  </div>
                ))}
              </dl>
            </CompareSection>

            <CompareSection title="Adapter docs">
              <p>
                Setup guides:{" "}
                <DocsVersionLink
                  className="text-fd-primary underline-offset-4 hover:underline"
                  docsPath={a.docs}
                  forceLatest
                >
                  {a.name} adapter
                </DocsVersionLink>{" "}
                and{" "}
                <DocsVersionLink
                  className="text-fd-primary underline-offset-4 hover:underline"
                  docsPath={b.docs}
                  forceLatest
                >
                  {b.name} adapter
                </DocsVersionLink>
                . Sending from your own domain? Verify SPF, DKIM, and DMARC with the free{" "}
                <Link
                  className="text-fd-primary underline-offset-4 hover:underline"
                  to="/tools/email-dns-checker"
                >
                  email DNS checker
                </Link>
                .
              </p>
            </CompareSection>
          </div>
        </article>
      </main>
    </HomeLayout>
  );
}

function sendSnippet(key: ProviderKey, importPath: string) {
  return `import { createEmailClient } from "@opencoredev/email-sdk";
import { ${key} } from "${importPath}";

const client = createEmailClient({
  adapters: [${getAdapterConfigSnippet(key)}],
});

await client.send({
  from: "hello@yourdomain.com",
  to: "user@example.com",
  subject: "Welcome!",
  html: "<p>It works.</p>",
});`;
}

function fallbackSnippet(pair: ComparePair, importPathA: string, importPathB: string) {
  return `import { createEmailClient } from "@opencoredev/email-sdk";
import { ${pair.a} } from "${importPathA}";
import { ${pair.b} } from "${importPathB}";

const client = createEmailClient({
  adapters: [
    ${getAdapterConfigSnippet(pair.a)},
    ${getAdapterConfigSnippet(pair.b)},
  ],
  defaultAdapter: "${pair.a}",
  fallback: ["${pair.b}"],
});`;
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-fd-border bg-fd-secondary/50 p-4 text-xs leading-6">
      <code>{children}</code>
    </pre>
  );
}

function CompareSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="border-t border-fd-border pt-6">
      <h2 className="text-xl font-medium text-fd-foreground">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
