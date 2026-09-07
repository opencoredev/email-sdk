import { createFileRoute, Link } from "@tanstack/react-router";

import { DocsVersionLink } from "@/components/docs-version-link";
import { homeStructuredData, siteTitle } from "@/lib/metadata";
import { appDescription, gitConfig, siteUrl } from "@/lib/shared";
import { sponsorHref, sponsors } from "@/lib/sponsors";

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

// The Paper design shows these eleven sponsor slots in this order.
const sponsorNames = [
  "Resend",
  "Sequenzy",
  "JetEmail",
  "Primitive",
  "Lettermint",
  "Instatus",
  "Neon",
  "Notra",
  "Zernio",
  "Customer.io",
  "Context.dev",
] as const;

const adapterNames = ["Resend", "Sequenzy", "JetEmail", "Primitive", "Lettermint"] as const;

type FooterLink = {
  label: string;
  href: string;
  docs?: boolean;
  internal?: boolean;
};

const footerGroups: readonly { label: string; links: readonly FooterLink[] }[] = [
  {
    label: "Product",
    links: [
      { label: "Docs", href: "/docs", docs: true },
      { label: "Adapters", href: "/docs/adapters", docs: true },
      { label: "Compare providers", href: "/compare", internal: true },
    ],
  },
  {
    label: "Package",
    links: [
      { label: "npm", href: "https://www.npmjs.com/package/@opencoredev/email-sdk" },
      { label: "MIT license", href: `${githubUrl}/blob/main/LICENSE` },
      { label: "Changelog", href: `${githubUrl}/releases` },
    ],
  },
  {
    label: "Project",
    links: [
      { label: "GitHub", href: githubUrl },
      { label: "Sponsor", href: sponsorHref },
      { label: "Blog", href: "/blog", internal: true },
    ],
  },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: siteTitle },
      { name: "description", content: appDescription },
      { property: "og:url", content: siteUrl },
      { "script:ld+json": homeStructuredData },
    ],
    links: [{ rel: "canonical", href: siteUrl }],
  }),
  component: Home,
});

function sponsorByName(name: string) {
  const sponsor = sponsors.find((entry) => entry.name === name);
  if (!sponsor) throw new Error(`Unknown sponsor "${name}" referenced by the landing page`);
  return sponsor;
}

function Home() {
  return (
    <main className="email-landing">
      <div aria-hidden="true" className="landing-grid-rule landing-grid-rule-left" />
      <div aria-hidden="true" className="landing-grid-rule landing-grid-rule-right" />
      <Nav />
      <Hero />
      <div aria-hidden="true" className="landing-nav-rule" />
      <Sponsors />
      <FlockDivider />
      <OneCall />
      <Adapters />
      <Footer />
      <div aria-hidden="true" className="landing-hero-art">
        <div className="landing-engraving" />
      </div>
    </main>
  );
}

function Nav() {
  return (
    <nav className="landing-nav" aria-label="Primary navigation">
      <Link className="landing-brand" to="/">
        <img alt="" aria-hidden="true" src="/logo.png" />
        Email SDK
      </Link>
      <div className="landing-nav-links">
        <DocsVersionLink>Docs</DocsVersionLink>
        <DocsVersionLink docsPath="/docs/adapters">Adapters</DocsVersionLink>
        <Link to="/compare">Compare</Link>
        <a href={githubUrl} rel="noreferrer" target="_blank">
          GitHub
        </a>
        <DocsVersionLink className="landing-nav-cta" docsPath="/docs/getting-started/quickstart">
          Get started
        </DocsVersionLink>
      </div>
      <DocsVersionLink aria-label="Open documentation" className="landing-mobile-menu" docsPath="/docs">
        Docs
      </DocsVersionLink>
    </nav>
  );
}

function Hero() {
  return (
    <section className="landing-hero" aria-labelledby="landing-heading">
      <h1 id="landing-heading">Email for TypeScript apps.</h1>
      <p id="landing-summary">
        One typed send() call. Use the provider account you already have.
      </p>
      <div className="landing-hero-actions">
        <DocsVersionLink className="landing-button landing-button-primary" docsPath="/docs/getting-started/quickstart">
          Start sending
        </DocsVersionLink>
        <DocsVersionLink className="landing-button landing-button-secondary" docsPath="/docs/adapters">
          Browse adapters
        </DocsVersionLink>
      </div>
    </section>
  );
}

function SectionLabel({
  id,
  title,
  children,
  after,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  after?: React.ReactNode;
}) {
  return (
    <div className="landing-section-label">
      <h2 id={id}>{title}</h2>
      <p>{children}</p>
      {after}
    </div>
  );
}

function OneCall() {
  return (
    <section className="landing-section landing-one-call" aria-labelledby="landing-one-call-heading">
      <SectionLabel
        id="landing-one-call-heading"
        title="One call"
        after={
          <DocsVersionLink className="landing-section-link" docsPath="/docs/getting-started/quickstart">
            Run the quickstart →
          </DocsVersionLink>
        }
      >
        Write the email once. Any of the 24 adapters sends it.
      </SectionLabel>
      <CodePanel />
    </section>
  );
}

function CodePanel() {
  return (
    <div className="landing-code-panel">
      <div className="landing-code-header">
        <span>src/email.ts</span>
        <span>TypeScript</span>
      </div>
      <pre className="landing-code" aria-label="TypeScript email send example">
        <code>
          <span className="landing-code-line">
            <b>import </b>
            <em>{"{ createEmailClient } "}</em>
            <b>from </b>
            <i>'@opencoredev/email-sdk'</i>;
          </span>
          <span className="landing-code-line">
            <b>import </b>
            <em>{"{ resend } "}</em>
            <b>from </b>
            <i>'@opencoredev/email-sdk/resend'</i>;
          </span>
          <span className="landing-code-gap" />
          <span className="landing-code-line">
            <b>const </b>
            <em>email </em>= createEmailClient({"{"}
          </span>
          <span className="landing-code-line">
            {"  adapters: ["}
            <em>resend</em>
            {"({ apiKey: process.env."}
            <em>RESEND_API_KEY</em>
            {"! })],"}
          </span>
          <span className="landing-code-line">{"});"}</span>
          <span className="landing-code-gap" />
          <span className="landing-code-line">
            <b>const </b>
            <em>result </em>= <b>await </b>
            <em>email</em>.send({"{"}
          </span>
          <span className="landing-code-line">
            {"  from: "}
            <i>{"'Acme <hello@acme.dev>'"}</i>,
          </span>
          <span className="landing-code-line">
            {"  to: "}
            <i>'ada@example.com'</i>,
          </span>
          <span className="landing-code-line">
            {"  subject: "}
            <i>'Welcome'</i>,
          </span>
          <span className="landing-code-line">
            {"  text: "}
            <i>'Hi Ada, your account is ready.'</i>,
          </span>
          <span className="landing-code-line">{"});"}</span>
          <span className="landing-code-line">
            console.log(<em>result</em>.adapter, <em>result</em>.id);
          </span>
        </code>
      </pre>
    </div>
  );
}

function Adapters() {
  return (
    <section className="landing-section landing-adapters" aria-labelledby="landing-adapters-heading">
      <SectionLabel
        id="landing-adapters-heading"
        title="Adapters"
        after={
          <Link className="landing-section-link" to="/compare">
            Compare providers →
          </Link>
        }
      >
        Keep your provider account and API key. Your send calls stay the same when you switch.
      </SectionLabel>
      <div className="landing-adapter-list">
        {adapterNames.map((name) => {
          const adapter = sponsorByName(name);
          return (
            <DocsVersionLink docsPath={`/docs/adapters/${name.toLowerCase()}`} key={name}>
              <img alt="" aria-hidden="true" src={adapter.logo} />
              <span>{name}</span>
            </DocsVersionLink>
          );
        })}
        <DocsVersionLink className="landing-adapter-more" docsPath="/docs/adapters">
          + 19 more in the registry →
        </DocsVersionLink>
      </div>
      <div aria-hidden="true" className="landing-art landing-art-globe">
        <div className="landing-engraving" />
      </div>
    </section>
  );
}

function FlockDivider() {
  return (
    <div aria-hidden="true" className="landing-flock">
      <div className="landing-engraving" />
    </div>
  );
}

function Sponsors() {
  return (
    <section className="landing-section landing-sponsors" aria-labelledby="landing-sponsors-heading">
      <SectionLabel id="landing-sponsors-heading" title="Sponsors">
        They pay for the maintenance. Four slots are open.
      </SectionLabel>
      <div className="landing-sponsor-grid">
        {sponsorNames.map((name) => {
          const sponsor = sponsorByName(name);
          return (
            <a
              className="landing-sponsor"
              href={sponsor.href}
              key={sponsor.name}
              rel="noreferrer"
              target="_blank"
            >
              <span className="landing-sponsor-mark">
                <img alt="" aria-hidden="true" src={sponsor.logo} />
              </span>
              <span>{sponsor.name}</span>
            </a>
          );
        })}
        <a className="landing-sponsor landing-sponsor-open" href={sponsorHref} rel="noreferrer" target="_blank">
          <span className="landing-sponsor-mark">+</span>
          <span>Sponsor</span>
        </a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="landing-footer">
      <div aria-hidden="true" className="landing-footer-rule" />
      <div className="landing-footer-columns">
        <div className="landing-footer-brand">
          <Link to="/">Email SDK</Link>
          <p>Open-source email tools for TypeScript apps.</p>
          <span>© 2026 OpenCore. MIT.</span>
        </div>
        {footerGroups.map((group) => (
          <nav aria-label={`${group.label} links`} className="landing-footer-group" key={group.label}>
            <span className="landing-footer-label">{group.label}</span>
            {group.links.map((item) =>
              item.docs ? (
                <DocsVersionLink docsPath={item.href} key={item.label}>
                  {item.label}
                </DocsVersionLink>
              ) : item.internal ? (
                <Link key={item.label} to={item.href}>
                  {item.label}
                </Link>
              ) : (
                <a href={item.href} key={item.label} rel="noreferrer" target="_blank">
                  {item.label}
                </a>
              ),
            )}
          </nav>
        ))}
      </div>
      <div aria-hidden="true" className="landing-mountains">
        <div className="landing-engraving" />
      </div>
    </footer>
  );
}
