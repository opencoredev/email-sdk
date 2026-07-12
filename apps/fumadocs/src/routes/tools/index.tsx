import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { baseOptions } from "@/lib/layout.shared";
import { appName, siteUrl } from "@/lib/shared";

const pageTitle = `Free email tools - ${appName}`;
const pageDescription =
  "Free tools for developers who send email: check SPF, DKIM, DMARC, and MX records for any domain, and compare transactional email providers side by side.";

export const Route = createFileRoute("/tools/")({
  head: () => ({
    meta: [
      { title: pageTitle },
      { name: "description", content: pageDescription },
      { property: "og:title", content: pageTitle },
      { property: "og:description", content: pageDescription },
      { property: "og:url", content: `${siteUrl}/tools` },
    ],
    links: [{ rel: "canonical", href: `${siteUrl}/tools` }],
  }),
  component: ToolsIndex,
});

function ToolsIndex() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <article className="mx-auto max-w-3xl px-6 py-14 md:px-10 lg:px-14">
          <p className="text-sm font-medium text-fd-muted-foreground">Free tools</p>
          <h1 className="mt-3 text-4xl font-medium leading-tight md:text-5xl">Free email tools</h1>
          <p className="mt-5 text-base leading-7 text-fd-muted-foreground md:text-lg">
            Utilities from the Email SDK project — free, no signup, built on the same data and
            checks the SDK uses.
          </p>

          <div className="mt-10 grid gap-4">
            <ToolCard
              description="Check a domain's SPF, DKIM, DMARC, and MX records with pass/warn/fail explanations and provider-specific setup links."
              title="Email DNS checker"
              to="/tools/email-dns-checker"
            />
            <ToolCard
              description="Side-by-side message-field support for Resend, Postmark, SendGrid, Mailgun, AWS SES, Brevo, and more — from the SDK's own capability matrix."
              title="Provider comparisons"
              to="/compare"
            />
          </div>
        </article>
      </main>
    </HomeLayout>
  );
}

function ToolCard({ description, title, to }: { description: string; title: string; to: string }) {
  return (
    <Link
      className="rounded-lg border border-fd-border p-5 transition-colors hover:border-fd-primary"
      to={to}
    >
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">{description}</p>
    </Link>
  );
}
