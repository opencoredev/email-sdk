export const appName = "Email SDK";
export const appDescription =
  "A TypeScript email SDK for unified email sending with Resend, SMTP, Postmark, SendGrid, Mailgun, AWS SES, fallbacks, plugins, and a local CLI.";
export const docsRoute = "/docs";
export const siteUrl = (import.meta.env.VITE_SITE_URL ?? "https://email-sdk.dev").replace(
  /\/$/,
  "",
);
export const siteOgImagePath = "/og/email-sdk.png";
export const siteOgImageVersion = import.meta.env.VITE_OG_IMAGE_VERSION || "dev";
export const siteOgImageUrl = `${siteUrl}${siteOgImagePath}?v=${encodeURIComponent(
  siteOgImageVersion,
)}`;

// fill this with your actual GitHub info, for example:
export const gitConfig = {
  user: "opencoredev",
  repo: "email-sdk",
  branch: "main",
};
