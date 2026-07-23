import { createFileRoute, Link } from "@tanstack/react-router";

import { DocsVersionLink } from "@/components/docs-version-link";
import { homeStructuredData, siteTitle } from "@/lib/metadata";
import { appDescription, gitConfig, siteUrl } from "@/lib/shared";
import { openSponsorSlots, sponsorHref, sponsors } from "@/lib/sponsors";

const adapterNames = ["Resend", "Sequenzy", "JetEmail", "Primitive", "Lettermint"] as const;

type FooterLink = {
  label: string;
  href: string;
  internal?: boolean;
  accent?: boolean;
};

const footerGroups: readonly { label: string; links: readonly FooterLink[] }[] = [
  {
    label: "Product",
    links: [
      { label: "Docs", href: "/docs", internal: true },
      { label: "Adapters", href: "/docs/adapters", internal: true },
    ],
  },
  {
    label: "Package",
    links: [
      { label: "npm", href: "https://www.npmjs.com/package/@opencoredev/email-sdk" },
      { label: "AGPL-3.0", href: `https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/main/LICENSE` },
    ],
  },
  {
    label: "Project",
    links: [
      { label: "GitHub", href: `https://github.com/${gitConfig.user}/${gitConfig.repo}` },
      { label: "Sponsor", href: sponsorHref, accent: true },
    ],
  },
] as const;

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

function Home() {
  return (
    <main className="email-landing">
      <Hero />
      <Sponsors />
      <CodeToInbox />
      <MobileSafety />
      <Adapters />
      <MobileOperate />
      <Footer />
    </main>
  );
}

function Hero() {
  return (
    <section className="landing-hero" aria-labelledby="landing-heading">
      <div className="landing-hero-image" />
      <div className="landing-hero-shade" />

      <nav className="landing-nav" aria-label="Primary navigation">
        <Link className="landing-brand" to="/">
          <img alt="" aria-hidden="true" src="/landing/email-sdk-mark.png" />
          <span>Email SDK</span>
        </Link>
        <div className="landing-nav-links">
          <DocsVersionLink>Docs</DocsVersionLink>
          <DocsVersionLink docsPath="/docs/adapters">Adapters</DocsVersionLink>
          <a href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`} rel="noreferrer" target="_blank">
            GitHub
          </a>
          <DocsVersionLink className="landing-nav-cta" docsPath="/docs/getting-started/quickstart">
            Get started
          </DocsVersionLink>
        </div>
        <DocsVersionLink
          aria-label="Open documentation"
          className="landing-mobile-menu"
          docsPath="/docs"
        >
          Docs
        </DocsVersionLink>
      </nav>

      <div className="landing-hero-copy">
        <h1 id="landing-heading">
          Send email.
          <br />
          Switch providers.
        </h1>
        <p id="landing-summary">
          An open-source TypeScript SDK for transactional email.
          <span className="landing-hero-brand-line">23 adapters. One typed SDK.</span>
        </p>
        <div className="landing-hero-actions">
          <DocsVersionLink className="landing-button landing-button-primary" docsPath="/docs/getting-started/quickstart">
            Start sending ↗
          </DocsVersionLink>
          <DocsVersionLink className="landing-button landing-button-secondary" docsPath="/docs/adapters">
            Browse adapters
          </DocsVersionLink>
        </div>
      </div>
    </section>
  );
}

function Sponsors() {
  return (
    <section className="landing-sponsors" aria-labelledby="landing-sponsors-heading">
      <div className="landing-container">
        <h2 id="landing-sponsors-heading">Sponsors</h2>
        <div className="landing-sponsor-grid">
          {sponsors.map((sponsor) => (
            <a
              className="landing-sponsor"
              data-sponsor={sponsor.name.toLowerCase()}
              href={sponsor.href}
              key={sponsor.name}
              rel="noreferrer"
              target="_blank"
            >
              <span className="landing-sponsor-mark">
                <img alt={`${sponsor.name} logo`} src={sponsor.logo} />
              </span>
              <span>{sponsor.name} ↗</span>
            </a>
          ))}
          {openSponsorSlots.map((slot, index) => (
            <a
              className="landing-sponsor landing-sponsor-open"
              href={sponsorHref}
              key={`sponsor-slot-${slot}`}
              rel="noreferrer"
              target="_blank"
            >
              <span className="landing-sponsor-mark">+</span>
              <span>{index === 0 ? "Sponsor ↗" : "Open spot"}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function CodeToInbox() {
  return (
    <section className="landing-code-section" aria-labelledby="landing-code-heading">
      <div className="landing-container">
        <h2 id="landing-code-heading">
          Write one email.
          <br />
          Send it through any adapter.
        </h2>
        <div className="landing-code-flow">
          <CodePanel />
          <div aria-hidden="true" className="landing-route-arrow">
            <span />→
          </div>
          <EmailNotification />
        </div>
      </div>
    </section>
  );
}

function CodePanel() {
  return (
    <div className="landing-code-panel">
      <div className="landing-code-header">
        <span>src/email.ts</span>
        <span className="landing-code-language">TypeScript</span>
      </div>
      <pre className="landing-code landing-code-desktop" aria-label="TypeScript email send example">
        <code>
          <span><b>import</b> {"{ createEmailClient }"} <b>from</b> <i>'@opencoredev/email-sdk'</i></span>
          <span><b>import</b> {"{ resend }"} <b>from</b> <i>'@opencoredev/email-sdk/resend'</i></span>
          <span className="landing-code-space" />
          <span><b>const</b> <em>email</em> = createEmailClient({"{"})</span>
          <span className="landing-code-indent">adapters: [resend({"{ apiKey: process.env.RESEND_API_KEY! }"})],</span>
          <span>{"})"}</span>
          <span className="landing-code-space" />
          <span><b>await</b> <em>email</em>.send({"{"}</span>
          <span className="landing-code-indent"><i>from: 'hello@acme.dev',</i></span>
          <span className="landing-code-indent"><i>to: 'ada@example.com',</i></span>
          <span className="landing-code-indent"><i>subject: 'Welcome',</i></span>
          <span className="landing-code-indent"><i>text: 'Hi Ada, your account is ready.',</i></span>
          <span>{"})"}</span>
        </code>
      </pre>
      <pre className="landing-code landing-code-mobile" aria-label="TypeScript email send example">
        <code>{`import { createEmailClient } from '@opencoredev/email-sdk'
import { resend } from '@opencoredev/email-sdk/resend'

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
})
await email.send({
  from: 'hello@acme.dev',
  to: 'ada@example.com',
  subject: 'Welcome',
  text: 'Hi Ada, your account is ready.',
})`}</code>
      </pre>
    </div>
  );
}

function EmailNotification() {
  return (
    <div className="landing-email-outcome">
      <article className="landing-email-card" aria-label="Gmail notification preview">
        <div className="landing-email-meta">
          <span className="landing-email-app">
            <span className="landing-gmail-mark">
              <img alt="" aria-hidden="true" src="/landing/gmail.png" />
            </span>
            Gmail
          </span>
          <span>now</span>
        </div>
        <div>
          <h3>Welcome</h3>
          <p>Hi Ada, your account is ready.</p>
        </div>
      </article>
    </div>
  );
}

function MobileSafety() {
  const outcomes = [
    ["The provider did not send", "Try the fallback."],
    ["Delivery is unclear", "Return the error."],
    ["The provider accepted it", "Return the receipt."],
  ] as const;

  return (
    <section className="landing-mobile-only landing-mobile-safety" aria-labelledby="delivery-safety-heading">
      <p className="landing-kicker">Delivery safety</p>
      <h2 id="delivery-safety-heading">Retry confirmed failures. Stop when delivery is unknown.</h2>
      <p>Email SDK only tries a fallback when it knows the first attempt did not send.</p>
      <div className="landing-outcomes">
        {outcomes.map(([condition, outcome]) => (
          <div key={condition}>
            <span>{condition}</span>
            <strong>{outcome}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function Adapters() {
  const adapterSponsors = adapterNames.map((name) => sponsors.find((sponsor) => sponsor.name === name)!);

  return (
    <section className="landing-adapters" aria-labelledby="landing-adapters-heading">
      <div className="landing-container">
        <div className="landing-adapters-heading">
          <h2 id="landing-adapters-heading">Adapters</h2>
          <div>
            <p>Use the provider account you already have. Your send calls stay the same.</p>
            <DocsVersionLink docsPath="/docs/adapters">Explore all 23 →</DocsVersionLink>
          </div>
        </div>
        <div className="landing-mobile-adapters-heading">
          <h2>
            Switch providers without rewriting your send code.
          </h2>
          <p>Use the provider account and API key you already have.</p>
        </div>
        <div className="landing-adapter-band">
          {adapterSponsors.map((adapter) => (
            <DocsVersionLink docsPath={`/docs/adapters/${adapter.name.toLowerCase()}`} key={adapter.name}>
              <img alt={`${adapter.name} logo`} src={adapter.logo} />
              <span>{adapter.name}</span>
            </DocsVersionLink>
          ))}
        </div>
        <div className="landing-mobile-adapters">
          {adapterSponsors.map((adapter) => (
            <DocsVersionLink docsPath={`/docs/adapters/${adapter.name.toLowerCase()}`} key={adapter.name}>
              {adapter.name}
            </DocsVersionLink>
          ))}
          <DocsVersionLink docsPath="/docs/adapters">+ 18 more</DocsVersionLink>
        </div>
      </div>
    </section>
  );
}

function MobileOperate() {
  return (
    <section className="landing-mobile-only landing-mobile-operate" aria-labelledby="operate-heading">
      <h2 id="operate-heading">Check your configuration before a live send.</h2>
      <p>The CLI finds missing environment variables without calling the provider.</p>
      <div className="landing-terminal">
        <span>$ email-sdk doctor --adapter resend</span>
        <strong>resend looks configured.</strong>
        <span>No provider request made.</span>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="landing-closing">
      <div className="landing-container">
        <div className="landing-footer">
          <div className="landing-footer-brand">
            <Link to="/">
              <img alt="" aria-hidden="true" src="/landing/email-sdk-mark.png" />
              <span>Email SDK</span>
            </Link>
            <p>Open source TypeScript email infrastructure.</p>
          </div>
          <nav aria-label="Footer navigation" className="landing-footer-nav">
            {footerGroups.map((group) => (
              <div className="landing-footer-group" key={group.label}>
                <span className="landing-footer-label">{group.label}</span>
                {group.links.map((item) =>
                  item.internal ? (
                    <DocsVersionLink
                      className={item.accent ? "landing-footer-accent" : undefined}
                      docsPath={item.href}
                      key={item.label}
                    >
                      {item.label} ↗
                    </DocsVersionLink>
                  ) : (
                    <a
                      className={item.accent ? "landing-footer-accent" : undefined}
                      href={item.href}
                      key={item.label}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {item.label} ↗
                    </a>
                  ),
                )}
              </div>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
