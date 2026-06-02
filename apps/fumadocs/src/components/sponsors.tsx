import { ExternalLink } from "lucide-react";

type SponsorSpotlightProps = {
  compact?: boolean;
};

const sponsors = [
  {
    name: "Sequenzy",
    href: "https://www.sequenzy.com/",
    logo: "/og/provider-logos/sequenzy.jpeg",
    tier: "Special sponsors",
    label: "Sponsor",
  },
] as const;

export function SponsorSpotlight({ compact = false }: SponsorSpotlightProps) {
  return (
    <section
      aria-labelledby="sponsors-heading"
      className={`not-prose ${compact ? "pt-8" : "border-y border-fd-border/80 py-8"}`}
    >
      <div className={compact ? "mb-4" : "mb-7"}>
        <div className={compact ? "flex items-center gap-3" : ""}>
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
          <p
            className={
              compact ? "text-xs text-fd-muted-foreground" : "mt-1 text-sm text-fd-muted-foreground"
            }
          >
            Companies helping keep Email SDK practical and maintained.
          </p>
        </div>
      </div>

      {compact ? (
        <div className="flex flex-wrap gap-4">
          {sponsors.map((sponsor) => (
            <SponsorLink compact key={sponsor.name} sponsor={sponsor} />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="text-center text-sm font-medium text-fd-muted-foreground">
            Special sponsors
          </div>
          <div className="flex flex-wrap justify-center gap-8 sm:gap-10">
            {sponsors.map((sponsor) => (
              <SponsorLink key={sponsor.name} sponsor={sponsor} />
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
    <a
      aria-label={`Visit ${sponsor.name}`}
      className={
        compact
          ? "group grid justify-items-center gap-2 text-center"
          : "group grid justify-items-center gap-3 text-center"
      }
      href={sponsor.href}
      rel="noreferrer"
      target="_blank"
    >
      <span
        className={
          compact
            ? "grid size-14 place-items-center rounded-full border border-fd-border bg-white p-1.5 shadow-sm transition group-hover:-translate-y-0.5 group-hover:border-fd-primary/40 group-hover:shadow-md"
            : "grid size-24 place-items-center rounded-full border border-fd-border bg-white p-3 shadow-sm transition group-hover:-translate-y-0.5 group-hover:border-fd-primary/40 group-hover:shadow-md sm:size-28"
        }
      >
        <img
          alt={`${sponsor.name} logo`}
          className="size-full rounded-full object-contain"
          height={88}
          src={sponsor.logo}
          width={88}
        />
      </span>
      <span className={compact ? "space-y-0.5" : "space-y-1"}>
        {!compact ? (
          <span className="mx-auto inline-flex h-6 items-center rounded-full border border-fd-primary/20 bg-fd-primary/10 px-2.5 text-xs font-medium text-fd-primary">
            {sponsor.label}
          </span>
        ) : null}
        <span className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-fd-foreground group-hover:text-fd-primary">
          {sponsor.name}
          <ExternalLink aria-hidden="true" className="size-3.5" strokeWidth={2} />
        </span>
      </span>
    </a>
  );
}
