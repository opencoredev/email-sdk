import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

import { baseOptions } from "@/lib/layout.shared";
import { appName, siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: `Privacy Policy - ${appName}` },
      {
        name: "description",
        content:
          "Privacy policy for Email SDK, including website analytics, documentation usage, and support communications.",
      },
      { property: "og:title", content: `Privacy Policy - ${appName}` },
      {
        property: "og:description",
        content:
          "How Email SDK handles website analytics, documentation usage, support communications, and package data.",
      },
      { property: "og:url", content: `${siteUrl}/privacy` },
    ],
    links: [{ rel: "canonical", href: `${siteUrl}/privacy` }],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <article className="mx-auto max-w-3xl px-6 py-14 md:px-10 lg:px-14">
          <p className="text-sm font-medium text-fd-muted-foreground">Effective June 1, 2026</p>
          <h1 className="mt-3 text-4xl font-medium leading-tight md:text-5xl">Privacy Policy</h1>
          <p className="mt-5 text-base leading-7 text-fd-muted-foreground md:text-lg">
            Email SDK is an open-source developer tool. This site is used to publish documentation,
            examples, and release information for the package.
          </p>

          <div className="mt-10 space-y-9 text-sm leading-7 text-fd-muted-foreground md:text-base">
            <PolicySection title="What We Collect">
              We may receive basic website analytics, such as page views, referrers, browser
              information, and coarse region data. If you contact the project, open an issue, or
              contribute to the repository, we receive the information you choose to provide in that
              message or contribution.
            </PolicySection>

            <PolicySection title="What We Do Not Collect">
              This documentation site does not ask for payment details, account passwords, email
              provider API keys, or production email recipient lists. Do not paste secrets, tokens,
              or private customer data into public issues, discussions, or examples.
            </PolicySection>

            <PolicySection title="How We Use Information">
              We use analytics to understand which docs are useful, diagnose broken pages, and
              improve launch quality. Support and contribution data is used to respond to reports,
              review changes, and maintain the project.
            </PolicySection>

            <PolicySection title="Third-Party Services">
              The site is hosted on Vercel and may use Vercel Web Analytics. Package downloads,
              issues, pull requests, and repository activity are handled by npm and GitHub under
              their own policies.
            </PolicySection>

            <PolicySection title="Contact">
              For privacy questions about this project, open a GitHub issue or use the contact
              details published by OpenCore.
            </PolicySection>
          </div>
        </article>
      </main>
    </HomeLayout>
  );
}

function PolicySection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="border-t border-fd-border pt-6">
      <h2 className="text-xl font-medium text-fd-foreground">{title}</h2>
      <p className="mt-3">{children}</p>
    </section>
  );
}
