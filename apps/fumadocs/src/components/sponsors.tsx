import { ExternalLink } from "lucide-react";

const sponsors = [
  {
    name: "Sequenzy",
    href: "https://www.sequenzy.com/",
    logo: "/og/provider-logos/sequenzy.jpeg",
    label: "Special sponsor",
  },
] as const;

export function SponsorSpotlight() {
  return (
    <section
      aria-labelledby="sponsors-heading"
      className="not-prose border-y border-fd-border/80 py-8"
    >
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2
            className="text-2xl font-semibold tracking-normal text-fd-foreground"
            id="sponsors-heading"
          >
            Sponsors
          </h2>
          <p className="mt-1 text-sm text-fd-muted-foreground">
            Companies helping keep Email SDK moving.
          </p>
        </div>
        <a
          className="hidden text-sm font-medium text-fd-primary underline-offset-4 hover:underline sm:inline"
          href={sponsors[0].href}
          rel="noreferrer"
          target="_blank"
        >
          Visit Sequenzy
        </a>
      </div>

      <div className="flex flex-wrap justify-center gap-8 sm:gap-10">
        {sponsors.map((sponsor) => (
          <a
            aria-label={`Visit ${sponsor.name}`}
            className="group grid justify-items-center gap-3 text-center"
            href={sponsor.href}
            key={sponsor.name}
            rel="noreferrer"
            target="_blank"
          >
            <span className="grid size-24 place-items-center rounded-full border border-fd-border bg-white p-3 shadow-sm transition group-hover:-translate-y-0.5 group-hover:border-fd-primary/40 group-hover:shadow-md sm:size-28">
              <img
                alt={`${sponsor.name} logo`}
                className="size-full rounded-full object-contain"
                height={88}
                src={sponsor.logo}
                width={88}
              />
            </span>
            <span className="space-y-1">
              <span className="block text-xs font-medium text-fd-muted-foreground">
                {sponsor.label}
              </span>
              <span className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-fd-foreground group-hover:text-fd-primary">
                {sponsor.name}
                <ExternalLink aria-hidden="true" className="size-3.5" strokeWidth={2} />
              </span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
