import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

import { baseOptions } from "@/lib/layout.shared";
import { appName, siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: `Terms of Service - ${appName}` },
      {
        name: "description",
        content:
          "Terms for using the Email SDK documentation site, examples, and open-source package resources.",
      },
      { property: "og:title", content: `Terms of Service - ${appName}` },
      {
        property: "og:description",
        content:
          "Terms for using the Email SDK documentation site, examples, and open-source package resources.",
      },
      { property: "og:url", content: `${siteUrl}/terms` },
    ],
    links: [{ rel: "canonical", href: `${siteUrl}/terms` }],
  }),
  component: Terms,
});

function Terms() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <article className="mx-auto max-w-3xl px-6 py-14 md:px-10 lg:px-14">
          <p className="text-sm font-medium text-fd-muted-foreground">Effective June 1, 2026</p>
          <h1 className="mt-3 text-4xl font-medium leading-tight md:text-5xl">Terms of Service</h1>
          <p className="mt-5 text-base leading-7 text-fd-muted-foreground md:text-lg">
            These terms cover use of the Email SDK website, documentation, examples, and related
            project resources. The open-source package itself is governed by the license published
            with the repository and npm package.
          </p>

          <div className="mt-10 space-y-9 text-sm leading-7 text-fd-muted-foreground md:text-base">
            <TermsSection title="Use of the Site">
              You may use the documentation and examples to evaluate, integrate, and contribute to
              Email SDK. Do not attempt to disrupt the site, abuse search endpoints, or use the
              project infrastructure to send spam or unlawful content.
            </TermsSection>

            <TermsSection title="Open-Source Software">
              The npm package and source code are provided under the license in the repository.
              Review that license before redistributing, modifying, or embedding the package in your
              own work.
            </TermsSection>

            <TermsSection title="Examples and Provider Integrations">
              Documentation examples are provided for implementation guidance. You are responsible
              for validating provider configuration, credentials, deliverability, compliance, and
              production email behavior in your own application.
            </TermsSection>

            <TermsSection title="No Warranty">
              The site and project resources are provided as-is, without guarantees of uptime,
              completeness, or fitness for a particular production use case.
            </TermsSection>

            <TermsSection title="Privacy">
              The{" "}
              <Link className="text-fd-primary underline-offset-4 hover:underline" to="/privacy">
                Privacy Policy
              </Link>{" "}
              explains what information may be collected when you use this site or contact the
              project.
            </TermsSection>
          </div>
        </article>
      </main>
    </HomeLayout>
  );
}

function TermsSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="border-t border-fd-border pt-6">
      <h2 className="text-xl font-medium text-fd-foreground">{title}</h2>
      <p className="mt-3">{children}</p>
    </section>
  );
}
