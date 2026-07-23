// Single source of truth for sponsors. Consumed by the landing page
// and by scripts/og/generate-og-image.ts, which bakes this list into
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
    logo: "/landing/sponsors/resend.png",
  },
  {
    name: "Sequenzy",
    href: "https://www.sequenzy.com/?ref=emailsdk",
    logo: "/landing/sponsors/sequenzy.png",
  },
  {
    name: "JetEmail",
    href: "https://jetemail.com",
    logo: "/landing/sponsors/jetemail.svg",
  },
  {
    name: "Primitive",
    href: "https://www.primitive.dev",
    logo: "/landing/sponsors/primitive.png",
  },
  {
    name: "Lettermint",
    href: "https://lettermint.co/?ref=emailsdk",
    logo: "/landing/sponsors/lettermint.svg",
  },
  {
    name: "Instatus",
    href: "https://instatus.com/?ref=emailsdk",
    logo: "/landing/sponsors/instatus.png",
  },
  {
    name: "Neon",
    href: "https://neon.com",
    logo: "/landing/sponsors/neon.png",
  },
  {
    name: "Notra",
    href: "https://www.usenotra.com",
    logo: "/landing/sponsors/notra.svg",
  },
];

export const openSponsorSlots = [1, 2] as const;
export const sponsorHref = "https://github.com/sponsors/opencoredev";
