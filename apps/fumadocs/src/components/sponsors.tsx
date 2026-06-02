import { ExternalLink, Plus } from "lucide-react";

import { DocsVersionLink } from "@/components/docs-version-link";

type SponsorSpotlightProps = {
  compact?: boolean;
};

const sponsors = [
  {
    name: "Resend",
    href: "https://go.resend.com/email-sdk",
    docs: "/docs/adapters/resend",
    logo: "/og/provider-logos/resend-mark.svg",
  },
  {
    name: "Sequenzy",
    href: "https://www.sequenzy.com/",
    docs: "/docs/adapters/sequenzy",
    logo: "/og/provider-logos/sequenzy.jpeg",
    forceLatestDocs: true,
  },
] as const;

const openSponsorSlots = [1, 2] as const;
const sponsorHref = "https://github.com/sponsors/opencoredev";

export function SponsorSpotlight({ compact = false }: SponsorSpotlightProps) {
  return (
    <section
      aria-labelledby="sponsors-heading"
      className={`not-prose ${compact ? "pt-8" : "border-y border-fd-border/80 py-8"}`}
    >
      <div className={compact ? "mb-4" : "mb-7 text-center"}>
        <h2
          className={
            compact
              ? "text-sm font-medium text-fd-muted-foreground"
              : "text-2xl font-semibold tracking-normal text-fd-foreground"
          }
          id="sponsors-heading"
        >
          Sponsors
        </h2>
      </div>

      {compact ? (
        <div className="flex flex-wrap gap-4">
          {sponsors.map((sponsor) => (
            <SponsorLink compact key={sponsor.name} sponsor={sponsor} />
          ))}
          {openSponsorSlots.map((slot) => (
            <SponsorSlotLink compact key={`open-sponsor-slot-${slot}`} />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap justify-center gap-8 sm:gap-10">
            {sponsors.map((sponsor) => (
              <SponsorLink key={sponsor.name} sponsor={sponsor} />
            ))}
            {openSponsorSlots.map((slot) => (
              <SponsorSlotLink key={`open-sponsor-slot-${slot}`} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SponsorLink({
  compact = false,
  sponsor,
}: {
  compact?: boolean;
  sponsor: (typeof sponsors)[number];
}) {
  return (
    <div
      className={
        compact
          ? "group grid justify-items-center gap-2 text-center"
          : "group grid justify-items-center gap-3 text-center"
      }
    >
      <a
        aria-label={`Visit ${sponsor.name}`}
        className={
          compact
            ? "grid size-14 place-items-center rounded-full border border-fd-border bg-white p-1.5 shadow-sm transition group-hover:-translate-y-0.5 group-hover:border-fd-primary/40 group-hover:shadow-md"
            : "grid size-24 place-items-center rounded-full border border-fd-border bg-white p-3 shadow-sm transition group-hover:-translate-y-0.5 group-hover:border-fd-primary/40 group-hover:shadow-md sm:size-28"
        }
        href={sponsor.href}
        rel="noreferrer"
        target="_blank"
      >
        <img
          alt={`${sponsor.name} logo`}
          className="size-full rounded-full object-contain"
          height={88}
          src={sponsor.logo}
          width={88}
        />
      </a>
      <span className={compact ? "grid gap-1" : "grid gap-1.5"}>
        <a
          className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-fd-foreground transition hover:text-fd-primary"
          href={sponsor.href}
          rel="noreferrer"
          target="_blank"
        >
          {sponsor.name}
          <ExternalLink aria-hidden="true" className="size-3.5" strokeWidth={2} />
        </a>
        <DocsVersionLink
          className="text-xs font-medium text-fd-muted-foreground transition hover:text-fd-primary"
          docsPath={sponsor.docs}
          forceLatest={"forceLatestDocs" in sponsor && sponsor.forceLatestDocs}
        >
          Docs
        </DocsVersionLink>
      </span>
    </div>
  );
}

function SponsorSlotLink({ compact = false }: { compact?: boolean }) {
  return (
    <a
      aria-label="Sponsor Email SDK"
      className={
        compact
          ? "group grid justify-items-center gap-2 text-center"
          : "group grid justify-items-center gap-3 text-center"
      }
      href={sponsorHref}
      rel="noreferrer"
      target="_blank"
    >
      <span
        className={
          compact
            ? "grid size-14 place-items-center rounded-full border border-dashed border-fd-border bg-fd-muted/25 text-fd-muted-foreground transition group-hover:-translate-y-0.5 group-hover:border-fd-primary/60 group-hover:bg-fd-accent group-hover:text-fd-foreground"
            : "grid size-24 place-items-center rounded-full border border-dashed border-fd-border bg-fd-muted/25 text-fd-muted-foreground transition group-hover:-translate-y-0.5 group-hover:border-fd-primary/60 group-hover:bg-fd-accent group-hover:text-fd-foreground sm:size-28"
        }
      >
        <Plus aria-hidden="true" className={compact ? "size-5" : "size-7"} strokeWidth={2} />
      </span>
      <span className={compact ? "space-y-0.5" : "space-y-1"}>
        {!compact ? (
          <span className="block text-xs font-medium text-fd-muted-foreground">Open slot</span>
        ) : null}
        <span className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-fd-muted-foreground group-hover:text-fd-primary">
          Sponsor
          <ExternalLink aria-hidden="true" className="size-3.5" strokeWidth={2} />
        </span>
      </span>
    </a>
  );
}
