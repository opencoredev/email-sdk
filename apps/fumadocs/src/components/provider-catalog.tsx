import verification from "../../../../adapter-verification.json";

import { ExternalLink, Heart, VerifiedShield } from "@/components/icon";
import { DocsVersionLink } from "@/components/docs-version-link";
import { useSelectedDocsVersion } from "@/lib/docs-version-state";
import { providers, type Provider } from "@/lib/providers";
import { sponsors } from "@/lib/sponsors";

type VerifiedProvider = keyof typeof verification.liveChecks;

const sponsorNames = new Set(sponsors.map((sponsor) => sponsor.name));
const providerDescriptions: Record<Provider["key"], string> = {
  resend: "A strong default for developer-first transactional email.",
  postmark: "Great for focused transactional email and deliverability.",
  sendgrid: "Best when your product already runs on Twilio SendGrid.",
  ses: "A good fit for AWS teams sending at high volume.",
  mailgun: "Use with an existing Mailgun setup or sending domain.",
  mailersend: "A simple API with a friendly dashboard for growing teams.",
  brevo: "Use transactional email alongside your Brevo marketing stack.",
  mailchimp: "Best for products already using Mailchimp Transactional.",
  sparkpost: "Use when SparkPost already powers your email delivery.",
  mailtrap: "Useful when testing and production email live in Mailtrap.",
  cloudflare: "Send directly from apps running on Cloudflare Workers.",
  unosend: "A lightweight choice for straightforward product email.",
  scaleway: "A natural fit for apps hosted in the Scaleway ecosystem.",
  zeptomail: "Use transactional email alongside Zoho and ZeptoMail.",
  mailpace: "A simple transactional email API for smaller products.",
  iterable: "Best for lifecycle email managed through Iterable.",
  loops: "Send product and lifecycle email through your Loops account.",
  sequenzy: "Use one API for transactional email and email sequences.",
  jetemail: "A focused transactional email API for product teams.",
  primitive: "Use when your product already sends through Primitive.",
  lettermint: "Straightforward transactional email with a simple API.",
  plunk: "An open-source-friendly option for product email.",
  smtp: "Connect any existing SMTP server or self-hosted mail system.",
};

export function ProviderGrid() {
  const selectedVersion = useSelectedDocsVersion();
  const visibleProviders = (selectedVersion.current
    ? [...providers]
    : providers.filter((provider) => !("currentOnly" in provider && provider.currentOnly))
  ).sort(compareProviders);

  return (
    <div className="not-prose border-y border-fd-border">
      <div className="flex items-center gap-5 border-b border-fd-border py-3 text-xs text-fd-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Heart aria-hidden="true" className="size-4 fill-rose-500 text-rose-500" />
          Sponsor
        </span>
        <span className="inline-flex items-center gap-1.5">
          <VerifiedShield
            aria-hidden="true"
            className="size-4 fill-emerald-500 text-emerald-500 [&_path:last-child]:stroke-white"
            strokeWidth={2.25}
          />
          Verified
        </span>
      </div>
      <div className="divide-y divide-fd-border">
        {visibleProviders.map((provider) => (
          <ProviderRow key={provider.key} provider={provider} />
        ))}
      </div>
    </div>
  );
}

export function ProviderBadge({ adapter }: { adapter: string }) {
  const provider = providers.find((item) => item.key === adapter);

  if (!provider) {
    return null;
  }

  return (
    <div className="not-prose mb-8 border-y border-fd-border py-4 text-sm text-fd-foreground">
      <div className="flex flex-wrap items-center gap-3">
        <ProviderMark provider={provider} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{provider.name}</span>
            <ProviderStatus provider={provider} />
            <code className="break-all text-xs text-fd-muted-foreground">{provider.importPath}</code>
          </div>
        </div>
        <a
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-fd-border px-3 text-xs font-medium transition hover:bg-fd-accent"
          href={provider.website}
          rel="noreferrer"
          target="_blank"
        >
          Provider docs
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      </div>
    </div>
  );
}

function ProviderRow({ provider }: { provider: Provider }) {
  return (
    <article className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <ProviderMark provider={provider} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-fd-foreground">{provider.name}</span>
            <ProviderStatus provider={provider} />
          </div>
          <p className="mt-1 text-sm text-fd-muted-foreground">
            {providerDescriptions[provider.key]}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 pl-11 sm:pl-0">
        <DocsVersionLink
          className="inline-flex h-8 items-center justify-center rounded-md border border-fd-border px-3 text-xs font-medium transition hover:bg-fd-accent"
          docsPath={provider.docs}
          forceLatest={"currentOnly" in provider && provider.currentOnly}
        >
          Setup
        </DocsVersionLink>
        <a
          aria-label={`Open ${provider.name} website`}
          className="grid size-8 place-items-center rounded-md border border-fd-border text-fd-muted-foreground transition hover:bg-fd-accent hover:text-fd-foreground"
          href={provider.website}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      </div>
    </article>
  );
}

function ProviderStatus({ provider }: { provider: Provider }) {
  const sponsored = sponsorNames.has(provider.name);
  const verified = isVerified(provider.key);

  if (!sponsored && !verified) {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {sponsored ? (
        <span aria-label="Sponsor" className="inline-flex" role="img" title="Sponsor">
          <Heart aria-hidden="true" className="size-4 fill-rose-500 text-rose-500" />
        </span>
      ) : null}
      {verified ? (
        <span aria-label="Verified" className="inline-flex" role="img" title="Verified">
          <VerifiedShield
            aria-hidden="true"
            className="size-4 fill-emerald-500 text-emerald-500 [&_path:last-child]:stroke-white"
            strokeWidth={2.25}
          />
        </span>
      ) : null}
    </span>
  );
}

function compareProviders(left: Provider, right: Provider) {
  return providerPriority(left) - providerPriority(right);
}

function providerPriority(provider: Provider) {
  if (sponsorNames.has(provider.name)) {
    return 0;
  }

  if (isVerified(provider.key)) {
    return 1;
  }

  return 2;
}

function isVerified(key: string): key is VerifiedProvider {
  return Object.prototype.hasOwnProperty.call(verification.liveChecks, key);
}

function ProviderMark({ provider }: { provider: Provider }) {
  if (!provider.logo) {
    return (
      <span className="grid size-8 shrink-0 place-items-center text-[9px] font-semibold text-fd-muted-foreground">
        SMTP
      </span>
    );
  }

  const invertOnDark = "invertOnDark" in provider && provider.invertOnDark;

  return (
    <span className="grid size-8 shrink-0 place-items-center">
      <img
        alt={`${provider.name} logo`}
        className={`size-7 object-contain ${invertOnDark ? "dark:invert" : ""}`}
        height={28}
        src={provider.logo}
        width={28}
      />
    </span>
  );
}
