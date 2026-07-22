const latestDocsRedirects = {
  authentication: "getting-started/credentials",
  telemetry: "reference/telemetry",
  "plugins/writing-plugins": "guides/authoring/create-first-plugin",
  "plugins/api": "reference/plugin-api",
  "components/convex-email": "integrations/convex",
  "agents/skill": "integrations/agents/skill",
  "integrations/react-email": "ui/react-email",
  "integrations/react-email/components": "ui/react-email/components",
  "integrations/react-email/blocks": "ui/react-email/blocks",
  guides: "guides/schedule-email",
} as const;

export function getLatestDocsRedirect(slugs: readonly string[]) {
  return latestDocsRedirects[slugs.join("/") as keyof typeof latestDocsRedirects];
}
