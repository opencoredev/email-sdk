import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

import { baseOptions } from "@/lib/layout.shared";
import { appName, gitConfig, siteUrl } from "@/lib/shared";

const repoUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: `Contact - ${appName}` },
      {
        name: "description",
        content:
          "Contact the Email SDK project — report bugs, ask questions, disclose security issues, or sponsor development through GitHub.",
      },
      { property: "og:title", content: `Contact - ${appName}` },
      {
        property: "og:description",
        content:
          "How to reach the Email SDK project: GitHub issues for bugs, discussions for questions, private security reports, and sponsorship.",
      },
      { property: "og:url", content: `${siteUrl}/contact` },
    ],
    links: [{ rel: "canonical", href: `${siteUrl}/contact` }],
  }),
  component: Contact,
});

function Contact() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <article className="mx-auto max-w-3xl px-6 py-14 md:px-10 lg:px-14">
          <p className="text-sm font-medium text-fd-muted-foreground">Contact</p>
          <h1 className="mt-3 text-4xl font-medium leading-tight md:text-5xl">Contact</h1>
          <p className="mt-5 text-base leading-7 text-fd-muted-foreground md:text-lg">
            Email SDK is an open-source project maintained by OpenCore. The fastest way to reach the
            maintainers is on GitHub — issues and discussions are public, so others benefit from the
            answer too.
          </p>

          <div className="mt-10 space-y-9 text-sm leading-7 text-fd-muted-foreground md:text-base">
            <ContactSection title="Bugs and feature requests">
              Open an issue at{" "}
              <a
                className="text-fd-primary underline-offset-4 hover:underline"
                href={`${repoUrl}/issues`}
                rel="noreferrer"
                target="_blank"
              >
                github.com/{gitConfig.user}/{gitConfig.repo}/issues
              </a>
              . Include the package version, the adapter involved, and a minimal reproduction so the
              problem can be confirmed quickly.
            </ContactSection>

            <ContactSection title="Questions and usage help">
              Start a thread in{" "}
              <a
                className="text-fd-primary underline-offset-4 hover:underline"
                href={`${repoUrl}/discussions`}
                rel="noreferrer"
                target="_blank"
              >
                GitHub Discussions
              </a>
              . For integration patterns, check the{" "}
              <a className="text-fd-primary underline-offset-4 hover:underline" href="/docs">
                documentation
              </a>{" "}
              first — most setup and adapter questions are answered there.
            </ContactSection>

            <ContactSection title="Security reports">
              Please do not file public issues for vulnerabilities. Report them privately through{" "}
              <a
                className="text-fd-primary underline-offset-4 hover:underline"
                href={`${repoUrl}/security/advisories/new`}
                rel="noreferrer"
                target="_blank"
              >
                GitHub security advisories
              </a>{" "}
              so a fix can ship before disclosure.
            </ContactSection>

            <ContactSection title="Sponsorship">
              If Email SDK saves your team time, you can support ongoing maintenance through{" "}
              <a
                className="text-fd-primary underline-offset-4 hover:underline"
                href={`https://github.com/sponsors/${gitConfig.user}`}
                rel="noreferrer"
                target="_blank"
              >
                GitHub Sponsors
              </a>
              .
            </ContactSection>

            <ContactSection title="More about the project">
              Learn what Email SDK is and who maintains it on the{" "}
              <Link className="text-fd-primary underline-offset-4 hover:underline" to="/about">
                about page
              </Link>
              , and review how this site handles data in the{" "}
              <Link className="text-fd-primary underline-offset-4 hover:underline" to="/privacy">
                privacy policy
              </Link>
              .
            </ContactSection>
          </div>
        </article>
      </main>
    </HomeLayout>
  );
}

function ContactSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="border-t border-fd-border pt-6">
      <h2 className="text-xl font-medium text-fd-foreground">{title}</h2>
      <p className="mt-3">{children}</p>
    </section>
  );
}
