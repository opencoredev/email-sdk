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
  {
    name: "Zernio",
    href: "https://zernio.com",
    logo: "/landing/sponsors/zernio.svg",
  },
  {
    name: "Customer.io",
    href: "https://github.com/customerio",
    logo: "/landing/sponsors/customerio.svg",
  },
  {
    name: "Context.dev",
    href: "https://context.dev",
    logo: "/landing/sponsors/context-dev.svg",
  },
];

// Keep the sponsor count plus the open slots a multiple of the five-column
// landing grid, so the last row stays full instead of leaving one orphan tile.
export const openSponsorSlots = [1, 2, 3, 4] as const;
export const sponsorHref = "https://github.com/sponsors/opencoredev";
