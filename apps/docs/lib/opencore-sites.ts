// Leo's public sites, linked from the footer of each one. Every repo keeps an
// identical copy of this list, so update all of them together. URLs are the
// exact origin each site serves (some redirect apex to www), and the links stay
// plain followed links on purpose.

export interface OpenCoreSite {
  readonly name: string;
  readonly description: string;
  readonly url: string;
}

export const OPENCORE_SITES = [
  {
    name: "Social SDK",
    description: "TypeScript SDK for social APIs",
    url: "https://social-sdk.dev",
  },
  { name: "Email SDK", description: "Email for TypeScript apps", url: "https://email-sdk.dev" },
  {
    name: "Domain SDK",
    description: "Custom domains for TypeScript",
    url: "https://www.domain-sdk.dev",
  },
  { name: "SMS SDK", description: "One SDK for SMS providers", url: "https://www.sms-sdk.com" },
  {
    name: "Sandbox SDK",
    description: "One SDK for cloud sandboxes",
    url: "https://sandbox-sdk.app",
  },
  {
    name: "Login with ChatGPT",
    description: "ChatGPT sign-in for your app",
    url: "https://loginwithchatgpt.dev",
  },
  {
    name: "gradients.sh",
    description: "Animated gradients for React",
    url: "https://gradients.sh",
  },
  { name: "dithercn", description: "Dither effects for your app", url: "https://dithercn.dev" },
  { name: "BG0", description: "Background removal on your device", url: "https://bg0.dev" },
  { name: "convt", description: "File conversion on your computer", url: "https://convt.app" },
  { name: "Amend", description: "Close the loop on user requests", url: "https://amend.sh" },
  {
    name: "agentdrop",
    description: "Instant links for agent output",
    url: "https://www.agent-drop.co",
  },
  {
    name: "Akeru Bot",
    description: "Open-source desktop app for Grok bots",
    url: "https://www.akeru-bot.com",
  },
  { name: "Leo", description: "The developer behind OpenCore", url: "https://leodev.cv" },
] as const satisfies readonly OpenCoreSite[];

export type OpenCoreSiteUrl = (typeof OPENCORE_SITES)[number]["url"];

/** Every site except the one rendering the footer. */
export const otherOpenCoreSites = (current: OpenCoreSiteUrl): readonly OpenCoreSite[] =>
  OPENCORE_SITES.filter((site) => site.url !== current);
