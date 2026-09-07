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

const deliveryRules = [
  ["not_sent", "Not accepted. A configured fallback may try another adapter."],
  ["unknown", "Acceptance unclear. Inspect before sending again."],
  ["Accepted", "Keep the receipt. Acceptance is not inbox delivery."],
] as const;

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
      <OneCall />
      <BeforeLiveSend />
      <DeliveryRules />
      <WhenToUse />
      <Adapters />
      <FlockDivider />
      <Sponsors />
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
        Send, validate, test without sending, and inspect failures with the provider account you
        already have.
      </p>
      <div className="landing-hero-actions">
        <DocsVersionLink className="landing-button landing-button-primary" docsPath="/docs/getting-started/quickstart">
          Run the quickstart
        </DocsVersionLink>
        <DocsVersionLink className="landing-button landing-button-secondary" docsPath="/docs/reference/cli/doctor">
          Check your setup
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
        title="Send with the account you already have"
        after={
          <DocsVersionLink className="landing-section-link" docsPath="/docs/getting-started/quickstart">
            Run the quickstart →
          </DocsVersionLink>
        }
      >
        One adapter, one verified sender, one call. The result is provider acceptance, not inbox
        delivery.
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
          <span className="landing-code-line">{"  retry: { maxAttempts: 1 },"}</span>
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

function BeforeLiveSend() {
  return (
    <section className="landing-section landing-operate" aria-labelledby="landing-operate-heading">
      <SectionLabel
        id="landing-operate-heading"
        title="Check configuration. Test without email."
        after={
          <DocsVersionLink className="landing-section-link" docsPath="/docs/reference/cli/doctor">
            Read the doctor guide →
          </DocsVersionLink>
        }
      >
        <code>doctor</code> checks configuration locally; <code>--live</code> authenticates on
        request. The memory adapter tests sends with no network.
      </SectionLabel>
      <div className="landing-operate-body">
        <div className="landing-terminal">
          <div className="landing-code-header">
            <span>shell</span>
            <span>doctor</span>
          </div>
          <pre className="landing-code">
            <code>
              <span className="landing-code-line">
                $ npm exec --package=@opencoredev/email-sdk -- email-sdk doctor --adapter resend
              </span>
              <span className="landing-code-line landing-code-muted">
                resend: configuration ok (RESEND_API_KEY set). No provider request made.
              </span>
              <span className="landing-code-gap" />
              <span className="landing-code-line">
                $ email-sdk send --adapter resend --from ... --to ... --subject ... --text ...
                --dry-run
              </span>
              <span className="landing-code-line landing-code-muted">
                Validates fields and adapter support. Sends nothing.
              </span>
            </code>
          </pre>
        </div>
        <div className="landing-code-panel">
          <div className="landing-code-header">
            <span>email.test.ts</span>
            <span>no network</span>
          </div>
          <pre className="landing-code" aria-label="Memory adapter test example">
            <code>
              <span className="landing-code-line">
                <b>import </b>
                <em>{"{ memoryAdapter } "}</em>
                <b>from </b>
                <i>'@opencoredev/email-sdk/testing'</i>;
              </span>
              <span className="landing-code-gap" />
              <span className="landing-code-line">
                <b>const </b>
                <em>memory </em>= memoryAdapter();
              </span>
              <span className="landing-code-line">
                <b>const </b>
                <em>email </em>= createEmailClient({"{"}
              </span>
              <span className="landing-code-line">
                {"  adapters: ["}
                <em>memory</em>
                {"], telemetry: false,"}
              </span>
              <span className="landing-code-line">{"});"}</span>
              <span className="landing-code-line">
                <b>await </b>
                <em>email</em>.send(message);
              </span>
              <span className="landing-code-line">
                expect(<em>memory</em>.raw?.sent[0]?.message.subject).toBe(<i>'Welcome'</i>);
              </span>
            </code>
          </pre>
          <DocsVersionLink className="landing-panel-link" docsPath="/docs/guides/test-email-behavior">
            Write a no-network test →
          </DocsVersionLink>
        </div>
      </div>
    </section>
  );
}

function DeliveryRules() {
  return (
    <section className="landing-section landing-delivery" aria-labelledby="landing-delivery-heading">
      <SectionLabel
        id="landing-delivery-heading"
        title="When a send fails"
        after={
          <DocsVersionLink className="landing-section-link" docsPath="/docs/guides/troubleshoot-failed-sends">
            Inspect a failed send →
          </DocsVersionLink>
        }
      >
        Every error carries a code, the adapter, retryability, and a delivery state.
      </SectionLabel>
      <div className="landing-delivery-list">
        {deliveryRules.map(([condition, outcome]) => (
          <div key={condition}>
            <strong>{condition}</strong>
            <span>{outcome}</span>
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="landing-art landing-art-horn">
        <div className="landing-engraving" />
      </div>
    </section>
  );
}

function WhenToUse() {
  return (
    <section className="landing-section landing-fit" aria-labelledby="landing-fit-heading">
      <SectionLabel id="landing-fit-heading" title="Email SDK or a provider SDK?">
        A library, not an email service. You keep your provider account and billing.
      </SectionLabel>
      <div className="landing-fit-columns">
        <div>
          <h3>Use Email SDK when</h3>
          <ul>
            <li>You want validation, test adapters, and typed errors in one place.</li>
            <li>You need a fallback route after a confirmed failure.</li>
          </ul>
        </div>
        <div>
          <h3>A direct provider SDK may be enough when</h3>
          <ul>
            <li>You send through one provider and already handle tests and failures.</li>
            <li>You need provider-specific APIs outside the common message model.</li>
          </ul>
          <DocsVersionLink className="landing-section-link" docsPath="/docs/adapters/field-support">
            Compare supported fields →
          </DocsVersionLink>
        </div>
      </div>
    </section>
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
        Same send call across providers. Check supported fields before switching.
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
