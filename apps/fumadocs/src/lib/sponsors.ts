// Single source of truth for sponsors. Consumed by the SponsorSpotlight
// component AND by scripts/generate-og-image.ts, which bakes this list into
// the site-wide OG image on every build — edit here and both stay in sync.
export type Sponsor = {
  name: string;
  href: string;
  /** Path under public/, e.g. "/og/provider-logos/resend-mark.svg". */
  logo: string;
};

// Every sponsor listed here appears both on the website spotlight and in the
// OG image — sponsor amounts aren't fetchable at build time, so there is no
// tier-based filtering.
export const sponsors: readonly Sponsor[] = [
  {
    name: "Resend",
    href: "https://go.resend.com/email-sdk",
    logo: "/og/provider-logos/resend-mark.svg",
  },
  {
    name: "Sequenzy",
    href: "https://www.sequenzy.com/?ref=emailsdk",
    logo: "/og/provider-logos/sequenzy.jpeg",
  },
  {
    name: "JetEmail",
    href: "https://jetemail.com",
    logo: "/og/provider-logos/jetemail.jpeg",
  },
  {
    name: "Primitive",
    href: "https://www.primitive.dev",
    logo: "/og/provider-logos/primitive.png",
  },
  {
    name: "Lettermint",
    href: "https://lettermint.co/?ref=emailsdk",
    logo: "/og/provider-logos/lettermint.png",
  },
  {
    name: "Instatus",
    href: "https://instatus.com/?ref=emailsdk",
    logo: "/og/provider-logos/instatus.png",
  },
];

export const openSponsorSlots = [1] as const;
export const sponsorHref = "https://github.com/sponsors/opencoredev";
