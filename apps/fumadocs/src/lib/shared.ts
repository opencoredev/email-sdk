export const appName = "Email SDK";
export const siteDescription =
  "A lightweight TypeScript SDK for unified email sending with Resend, SMTP, Postmark, fallbacks, hooks, and a Bun CLI.";
const env = typeof process === "undefined" ? {} : process.env;
export const siteUrl = env.SITE_URL ?? env.VITE_SITE_URL ?? "https://email-sdk.dev";
export const docsRoute = "/docs";
export const docsImageRoute = "/og/docs";

// fill this with your actual GitHub info, for example:
export const gitConfig = {
  user: "email-sdk",
  repo: "email-sdk",
  branch: "main",
};
