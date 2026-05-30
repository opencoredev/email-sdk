export const appName = "Email SDK";
export const appDescription =
  "A lightweight TypeScript SDK for unified email sending with Resend, SMTP, Postmark, SendGrid, Mailgun, fallbacks, hooks, and a Bun CLI.";
export const docsRoute = "/docs";
export const siteUrl = (import.meta.env.VITE_SITE_URL ?? "https://email-sdk.dev").replace(
  /\/$/,
  "",
);
export const siteOgImagePath = "/og/email-sdk.png";
export const siteOgImageUrl = `${siteUrl}${siteOgImagePath}?v=20260530`;

// fill this with your actual GitHub info, for example:
export const gitConfig = {
  user: "opencoredev",
  repo: "email-sdk",
  branch: "main",
};
