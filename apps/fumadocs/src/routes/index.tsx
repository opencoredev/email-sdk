import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { Copy } from "@/components/icon";
import { DocsVersionLink } from "@/components/docs-version-link";
import { homeStructuredData, siteTitle } from "@/lib/metadata";
import { appDescription, gitConfig, siteUrl } from "@/lib/shared";
import { openSponsorSlots, sponsorHref, sponsors } from "@/lib/sponsors";

const installCommand = "bun add @opencoredev/email-sdk";
const adapterNames = ["Resend", "Sequenzy", "JetEmail", "Primitive", "Lettermint"] as const;

type FooterLink = {
  label: string;
  href: string;
  internal?: boolean;
  accent?: boolean;
};

const footerLinks: readonly FooterLink[] = [
  { label: "Docs", href: "/docs", internal: true },
  { label: "Adapters", href: "/docs/adapters", internal: true },
  { label: "npm", href: "https://www.npmjs.com/package/@opencoredev/email-sdk" },
  { label: "GitHub", href: `https://github.com/${gitConfig.user}/${gitConfig.repo}` },
  { label: "Sponsor", href: sponsorHref, accent: true },
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
      <Closing />
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
          One route.
          <br />
          Every provider.
        </h1>
        <p>Send, retry, personalize, and schedule through 23 providers with one TypeScript API.</p>
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
          Write the message once.
          <br />
          Choose the provider at the edge.
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
          <span className="landing-code-space" />
          <span><b>const</b> <em>email</em> = createEmailClient({"{ adapters: [resend] }"})</span>
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
        <code>{`const email = createEmailClient({
  adapters: [resend],
})
await email.send({
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
      <h2 id="delivery-safety-heading">Retry when you know. Stop when you don’t.</h2>
      <p>Another adapter is tried only after the provider confirms the message did not leave.</p>
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
            <p>Bring the provider account you already use. Your application keeps the same send flow.</p>
            <DocsVersionLink docsPath="/docs/adapters">Explore all 23 →</DocsVersionLink>
          </div>
        </div>
        <div className="landing-mobile-adapters-heading">
          <h2>
            Change the adapter.
            <br />
            Keep the workflow.
          </h2>
          <p>Bring the provider account you already use.</p>
        </div>
        <div className="landing-adapter-band">
          {adapterSponsors.map((adapter) => (
            <a href={adapter.href} key={adapter.name} rel="noreferrer" target="_blank">
              <img alt={`${adapter.name} logo`} src={adapter.logo} />
              <span>{adapter.name}</span>
            </a>
          ))}
        </div>
        <div className="landing-mobile-adapters">
          {adapterSponsors.map((adapter) => (
            <span key={adapter.name}>{adapter.name}</span>
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
      <h2 id="operate-heading">Check the route before it sends.</h2>
      <p>Validate credentials and message support without sending an email.</p>
      <div className="landing-terminal">
        <span>$ email-sdk doctor --adapter resend</span>
        <strong>✓ credentials found</strong>
        <strong>✓ message fields supported</strong>
        <span>No email sent.</span>
      </div>
    </section>
  );
}

function Closing() {
  const [copied, setCopied] = useState(false);

  async function copyInstallCommand() {
    await navigator.clipboard.writeText(installCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <footer className="landing-closing">
      <div className="landing-container">
        <div className="landing-closing-main">
          <div className="landing-closing-copy">
            <span className="landing-kicker">Install</span>
            <h2>Install once. Send anywhere.</h2>
            <p>Choose the adapter you already use, then send the exact message you wrote through one typed API.</p>
          </div>
          <div className="landing-install-panel">
            <button className="landing-install-command" onClick={copyInstallCommand} type="button">
              <code>{installCommand}</code>
              <span>
                <Copy aria-hidden="true" size={14} />
                {copied ? "copied" : "copy"}
              </span>
            </button>
            <div>
              <DocsVersionLink className="landing-button landing-button-primary" docsPath="/docs/getting-started/quickstart">
                Quickstart →
              </DocsVersionLink>
              <DocsVersionLink className="landing-button landing-button-secondary" docsPath="/docs/adapters">
                Browse adapters ↗
              </DocsVersionLink>
            </div>
          </div>
        </div>
        <div className="landing-footer-rail">
          <p>Open source TypeScript email infrastructure.</p>
          <nav aria-label="Footer navigation">
            {footerLinks.map((item) =>
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
            <span>MIT</span>
          </nav>
        </div>
      </div>
    </footer>
  );
}
