import { providers, type Provider } from "@/lib/providers";

export const pricingVolumes = [1_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const;

export type PricingVolume = (typeof pricingVolumes)[number];
export type PricingCurrency = "USD" | "EUR";
export type PricingStatusFilter = "all" | "public" | "free" | "variable";
export type PricingSort = "provider" | "cost-asc" | "cost-desc";

export type PriceCell =
  | { kind: "money"; currency: PricingCurrency; cents: number; qualifier?: "minimum" }
  | { kind: "custom"; label: "Custom" }
  | { kind: "variable"; label: "Varies" }
  | { kind: "unavailable"; label: "Unavailable" };

type PricingDetails = {
  model: string;
  sources: readonly { label: string; href: string }[];
  note: string;
  prices: readonly [PriceCell, PriceCell, PriceCell, PriceCell, PriceCell, PriceCell];
};

export type AdapterPricingRow = PricingDetails & {
  provider: Provider;
};

const usd = (dollars: number): PriceCell => ({
  kind: "money",
  currency: "USD",
  cents: Math.round(dollars * 100),
});
const eur = (euros: number): PriceCell => ({
  kind: "money",
  currency: "EUR",
  cents: Math.round(euros * 100),
});
const minimum = (dollars: number): PriceCell => ({
  kind: "money",
  currency: "USD",
  cents: Math.round(dollars * 100),
  qualifier: "minimum",
});
const custom: PriceCell = { kind: "custom", label: "Custom" };
const varies: PriceCell = { kind: "variable", label: "Varies" };
const unavailable: PriceCell = { kind: "unavailable", label: "Unavailable" };

const pricingByProvider = {
  resend: {
    model: "Plan + overage",
    sources: [
      {
        label: "Resend pricing",
        href: "https://resend.com/docs/knowledge-base/what-is-resend-pricing",
      },
    ],
    note: "Free includes 3K. Pro covers 50K and 100K; larger values use the cheaper available tier or published overage. Annual discounts are excluded.",
    prices: [usd(0), usd(20), usd(35), usd(170), usd(350), usd(650)],
  },
  sequenzy: {
    model: "Fixed volume tiers",
    sources: [{ label: "Sequenzy pricing", href: "https://www.sequenzy.com/pricing" }],
    note: "Free includes 2.5K. Requested volumes use the next published tier: 60K, 120K, 300K, 600K, or 1.2M. There is no public overage price.",
    prices: [usd(0), usd(49), usd(99), usd(199), usd(399), usd(799)],
  },
  jetemail: {
    model: "Plan + overage",
    sources: [{ label: "JetEmail pricing", href: "https://jetemail.com/pricing" }],
    note: "Free includes 3K. Pro costs $10 for 50K, then $0.20 per additional 1K.",
    prices: [usd(0), usd(10), usd(20), usd(50), usd(100), usd(200)],
  },
  primitive: {
    model: "Usage credits",
    sources: [{ label: "Primitive pricing", href: "https://www.primitive.dev/pricing" }],
    note: "Developer usage credits cover through 215K; Power costs $13 and covers 250K. The published 10K/day account cap makes 500K and 1M unavailable in a calendar month.",
    prices: [usd(0), usd(0), usd(0), usd(13), unavailable, unavailable],
  },
  lettermint: {
    model: "Plan + overage · EUR",
    sources: [{ label: "Lettermint pricing", href: "https://lettermint.co/pricing" }],
    note: "Free includes only 300 per month. Requested volumes use the next Starter tier. Prices stay in EUR; no currency conversion is applied.",
    prices: [eur(10), eur(40), eur(85), eur(175), eur(270), eur(500)],
  },
  postmark: {
    model: "Volume tiers",
    sources: [{ label: "Postmark pricing", href: "https://postmarkapp.com/pricing" }],
    note: "Free includes only 100. Published volume tiers cost less than a lower tier plus overage at these volumes.",
    prices: [usd(15), usd(55), usd(115), usd(245), usd(455), usd(775)],
  },
  sendgrid: {
    model: "Plan + overage",
    sources: [
      {
        label: "Twilio SendGrid pricing",
        href: "https://www.twilio.com/en-us/products/email-api/pricing",
      },
    ],
    note: "The current free offer is a 60-day trial, so it is excluded. Intermediate values use published Essentials or Pro overage.",
    prices: [usd(19.95), usd(19.95), usd(34.95), usd(166.95), usd(386.95), usd(733)],
  },
  cloudflare: {
    model: "Usage + platform base",
    sources: [
      {
        label: "Cloudflare pricing",
        href: "https://developers.cloudflare.com/email-service/platform/pricing/",
      },
    ],
    note: "Requires Workers Paid at $5 per account each month. That includes 3K emails, then usage costs $0.35 per 1K.",
    prices: [usd(5), usd(21.45), usd(38.95), usd(91.45), usd(178.95), usd(353.95)],
  },
  unosend: {
    model: "Prepaid credits",
    sources: [{ label: "Unosend pricing", href: "https://www.unosend.co/pricing" }],
    note: "The minimum 10K pack is $4 and credits last 90 days. The one-time signup grant and negotiated business discounts are excluded.",
    prices: [usd(4), usd(20), usd(40), usd(100), usd(200), usd(400)],
  },
  ses: {
    model: "Usage-based",
    sources: [{ label: "AWS SES pricing", href: "https://aws.amazon.com/ses/pricing/" }],
    note: "Uses switchable à-la-carte outbound pricing at $0.10 per 1K. Since July 21, 2026, new accounts default to Essentials at $0.16 per 1K but may switch. Attachments, transfer, dedicated IPs, global endpoints, add-ons, and the old 3K free tier, which is not generally recurring, are excluded.",
    prices: [usd(0.1), usd(5), usd(10), usd(25), usd(50), usd(100)],
  },
  mailgun: {
    model: "Plans + overage",
    sources: [{ label: "Mailgun pricing", href: "https://www.mailgun.com/pricing/" }],
    note: "The ongoing 100/day free allowance can cover 1K spread across a month. Higher cells use current Foundation or Scale published paths; temporary trials are excluded.",
    prices: [usd(0), usd(35), usd(75), usd(215), usd(400), usd(700)],
  },
  mailersend: {
    model: "Volume plans",
    sources: [{ label: "MailerSend pricing", href: "https://www.mailersend.com/pricing" }],
    note: "Free includes only 500. These are monthly Hobby or Starter prices; annual discounts are excluded.",
    prices: [usd(7), usd(35), usd(68), usd(162.5), usd(325), usd(600)],
  },
  brevo: {
    model: "Volume plans",
    sources: [{ label: "Brevo pricing", href: "https://www.brevo.com/pricing/" }],
    note: "Verified in Brevo's monthly USD calculator. Free permits 300/day and supports transactional email. Paid cells use Starter at 50K/100K, Standard at 250K/500K, and Professional at 1M. Annual discounts are excluded.",
    prices: [usd(0), usd(56), usd(82), usd(249), usd(429), usd(999)],
  },
  mailchimp: {
    model: "Required base plan + blocks",
    sources: [
      {
        label: "Mailchimp Transactional pricing",
        href: "https://mailchimp.com/pricing/transactional-email/",
      },
    ],
    note: "Includes the required minimum $20 Standard marketing plan for up to 500 contacts, plus 25K transactional blocks. Blocks 1–20 cost $20; blocks 21–40 cost $18. Temporary promotions are excluded.",
    prices: [usd(40), usd(60), usd(100), usd(220), usd(420), usd(740)],
  },
  sparkpost: {
    model: "Volume plans",
    sources: [
      { label: "Bird email pricing", href: "https://bird.com/en-us/pricing/email?sp=true" },
    ],
    note: "SparkPost uses Bird's current pricing. The test plan is not production, so it is excluded.",
    prices: [usd(20), usd(20), usd(30), usd(170), usd(290), usd(525)],
  },
  iterable: {
    model: "Custom contract",
    sources: [
      { label: "Iterable sales", href: "https://iterable.com/contact-sales/" },
      {
        label: "Iterable billing guide",
        href: "https://support.iterable.com/hc/en-us/articles/205480345-Usage-and-Billing",
      },
    ],
    note: "There is no public dollar price. Contracts may cover both the stored-user high-water mark and sends, so send volume alone cannot determine the bill.",
    prices: [custom, custom, custom, custom, custom, custom],
  },
  loops: {
    model: "Contact-based minimum",
    sources: [
      { label: "Loops pricing", href: "https://loops.so/pricing" },
      { label: "Loops free plan", href: "https://app.loops.so/docs/account/free-plan" },
    ],
    note: "Free allows 4K sends and up to 1K subscribed contacts. Paid plans include unlimited transactional sends from $49, but the bill can be higher with more than 5K subscribed marketing contacts.",
    prices: [usd(0), minimum(49), minimum(49), minimum(49), minimum(49), minimum(49)],
  },
  plunk: {
    model: "Usage-based",
    sources: [
      { label: "Plunk pricing", href: "https://www.useplunk.com/pricing" },
      { label: "Plunk billing guide", href: "https://docs.useplunk.com/concepts/billing" },
    ],
    note: "Free covers exactly 1K. Once paid, all email usage costs $0.001 per email.",
    prices: [usd(0), usd(50), usd(100), usd(250), usd(500), usd(1000)],
  },
  mailtrap: {
    model: "Fixed volume plans",
    sources: [{ label: "Mailtrap pricing", href: "https://mailtrap.io/pricing/?tab=email-api" }],
    note: "Free includes 4K with a 150/day cap. The 1M cell uses the cheapest public Enterprise plan that supports it: 1.5M at $750.",
    prices: [usd(0), usd(20), usd(30), usd(200), usd(300), usd(750)],
  },
  scaleway: {
    model: "Usage-based · EUR",
    sources: [
      {
        label: "Scaleway pricing",
        href: "https://www.scaleway.com/en/pricing/managed-services/",
      },
      {
        label: "Scaleway email FAQ",
        href: "https://www.scaleway.com/en/docs/transactional-email/faq/",
      },
    ],
    note: "Includes 300, then costs €0.25 per 1K of actual excess, rounded to cents and shown pre-tax. Quota increases above the default 10K require approval. Prices stay in EUR.",
    prices: [eur(0.18), eur(12.43), eur(24.93), eur(62.43), eur(124.93), eur(249.93)],
  },
  zeptomail: {
    model: "Prepaid credits",
    sources: [
      { label: "ZeptoMail pricing", href: "https://www.zoho.com/zeptomail/pricing.html" },
      {
        label: "ZeptoMail subscription guide",
        href: "https://www.zoho.com/zeptomail/help/subscription.html",
      },
    ],
    note: "Uses ceil(volume ÷ 10K) credits at $2.50 each. Credits expire after six months; the one-time first credit is excluded.",
    prices: [usd(2.5), usd(12.5), usd(25), usd(62.5), usd(125), usd(250)],
  },
  mailpace: {
    model: "Base + usage",
    sources: [{ label: "MailPace pricing", href: "https://mailpace.com/pricing" }],
    note: "$10 includes the first 10K, then usage costs $1 per 1K. The trial covers only 100.",
    prices: [usd(10), usd(50), usd(100), usd(250), usd(500), usd(1000)],
  },
  smtp: {
    model: "Separately chosen service",
    sources: [{ label: "SMTP adapter setup", href: "/docs/adapters/smtp" }],
    note: "The adapter is only the transport. Cost depends on the SMTP relay or server you choose, so showing $0 would be misleading.",
    prices: [varies, varies, varies, varies, varies, varies],
  },
} satisfies Record<Provider["key"], PricingDetails>;

export const adapterPricing: readonly AdapterPricingRow[] = providers.map((provider) => ({
  provider,
  ...pricingByProvider[provider.key],
}));

export function getPrice(row: AdapterPricingRow, volume: PricingVolume): PriceCell {
  return row.prices[pricingVolumes.indexOf(volume)];
}

export function formatPrice(price: PriceCell): string {
  if (price.kind !== "money") return price.label;

  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.currency,
    minimumFractionDigits: price.cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(price.cents / 100);

  return price.qualifier === "minimum" ? `${amount} min.` : amount;
}

export function formatPricingVolume(volume: PricingVolume): string {
  if (volume === 1_000_000) return "1M";
  return `${volume / 1_000}K`;
}

export function getAdapterPricingRows({
  query = "",
  status = "all",
  volume = 50_000,
  sort = "cost-asc",
}: {
  query?: string;
  status?: PricingStatusFilter;
  volume?: PricingVolume;
  sort?: PricingSort;
} = {}): AdapterPricingRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  return adapterPricing
    .filter((row) => {
      if (
        normalizedQuery &&
        !row.provider.name.toLocaleLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }

      const price = getPrice(row, volume);
      if (status === "public") return price.kind === "money";
      if (status === "free") return price.kind === "money" && price.cents === 0;
      if (status === "variable") {
        return price.kind === "custom" || price.kind === "variable";
      }
      return true;
    })
    .sort((left, right) => comparePricingRows(left, right, volume, sort));
}

function comparePricingRows(
  left: AdapterPricingRow,
  right: AdapterPricingRow,
  volume: PricingVolume,
  sort: PricingSort,
): number {
  if (sort === "provider") return left.provider.name.localeCompare(right.provider.name);

  const leftPrice = getPrice(left, volume);
  const rightPrice = getPrice(right, volume);
  const leftUsd = leftPrice.kind === "money" && leftPrice.currency === "USD";
  const rightUsd = rightPrice.kind === "money" && rightPrice.currency === "USD";

  if (leftUsd !== rightUsd) return leftUsd ? -1 : 1;
  if (!leftUsd || !rightUsd) return left.provider.name.localeCompare(right.provider.name);

  const difference = leftPrice.cents - rightPrice.cents;
  return (sort === "cost-desc" ? -difference : difference) ||
    left.provider.name.localeCompare(right.provider.name);
}
