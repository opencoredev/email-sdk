import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

import { DocsVersionLink } from "@/components/docs-version-link";
import { baseOptions } from "@/lib/layout.shared";
import { appName, siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: `About - ${appName}` },
      {
        name: "description",
        content:
          "About Email SDK — an open-source TypeScript SDK that sends transactional email through 22 provider APIs plus SMTP behind one typed API, maintained by OpenCore.",
      },
      { property: "og:title", content: `About - ${appName}` },
      {
        property: "og:description",
        content:
          "What Email SDK is, why it exists, and who maintains it — one typed email API across Resend, SMTP, Postmark, SendGrid, AWS SES, and more.",
      },
      { property: "og:url", content: `${siteUrl}/about` },
    ],
    links: [{ rel: "canonical", href: `${siteUrl}/about` }],
  }),
  component: About,
});

function About() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <article className="mx-auto max-w-3xl px-6 py-14 md:px-10 lg:px-14">
          <p className="text-sm font-medium text-fd-muted-foreground">About</p>
          <h1 className="mt-3 text-4xl font-medium leading-tight md:text-5xl">About Email SDK</h1>
          <p className="mt-5 text-base leading-7 text-fd-muted-foreground md:text-lg">
            Email SDK is an open-source TypeScript SDK for sending transactional email. It gives an
            application one typed client and one message shape, then routes each send to providers
            such as Resend, SMTP, Postmark, SendGrid, Mailgun, Unosend, AWS SES, and more.
          </p>

          <div className="mt-10 space-y-9 text-sm leading-7 text-fd-muted-foreground md:text-base">
            <AboutSection title="What it is">
              A single <code>send()</code> call with one normalized <code>EmailMessage</code> shape.
              Provider-specific behavior lives in adapters imported from their own entry points, so
              switching or adding a provider does not mean rewriting every place your app sends
              mail. The core ships with zero dependencies and includes its own SMTP transport.
            </AboutSection>

            <AboutSection title="Why it exists">
              Most applications start on one email provider and later need a second one for
              deliverability, cost, or regional routing. Email SDK keeps provider differences behind
              a consistent API with explicit routing, automatic retries on transient failures, and
              fallback routes between adapters that support the same fields — so changing providers
              is a configuration change, not a refactor.
            </AboutSection>

            <AboutSection title="Who maintains it">
              Email SDK is built and maintained by{" "}
              <a
                className="text-fd-primary underline-offset-4 hover:underline"
                href="https://opencore.dev"
                rel="noreferrer"
                target="_blank"
              >
                OpenCore
              </a>{" "}
              as an open-source project. The source, issues, and releases are public on{" "}
              <a
                className="text-fd-primary underline-offset-4 hover:underline"
                href="https://github.com/opencoredev/email-sdk"
                rel="noreferrer"
                target="_blank"
              >
                GitHub
              </a>
              , and the package is published to{" "}
              <a
                className="text-fd-primary underline-offset-4 hover:underline"
                href="https://www.npmjs.com/package/@opencoredev/email-sdk"
                rel="noreferrer"
                target="_blank"
              >
                npm
              </a>
              .
            </AboutSection>

            <AboutSection title="Where to go next">
              Read the{" "}
              <DocsVersionLink className="text-fd-primary underline-offset-4 hover:underline">
                documentation
              </DocsVersionLink>{" "}
              to install the package and send your first email, browse the{" "}
              <DocsVersionLink
                className="text-fd-primary underline-offset-4 hover:underline"
                docsPath="/docs/adapters"
              >
                adapters
              </DocsVersionLink>{" "}
              for each provider, or get in touch through the{" "}
              <Link className="text-fd-primary underline-offset-4 hover:underline" to="/contact">
                contact page
              </Link>
              .
            </AboutSection>
          </div>
        </article>
      </main>
    </HomeLayout>
  );
}

function AboutSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="border-t border-fd-border pt-6">
      <h2 className="text-xl font-medium text-fd-foreground">{title}</h2>
      <p className="mt-3">{children}</p>
    </section>
  );
}
