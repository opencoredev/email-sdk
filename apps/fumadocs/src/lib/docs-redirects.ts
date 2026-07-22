const latestDocsRedirects = {
  authentication: "getting-started/credentials",
  telemetry: "reference/telemetry",
  "plugins/writing-plugins": "guides/authoring/create-first-plugin",
  "plugins/api": "reference/plugin-api",
  "components/convex-email": "integrations/convex",
  "integrations/agents": "agents",
  "integrations/agents/ai-tools": "integrations/ai-sdk",
  "integrations/agents/skill": "getting-started/agent-skill",
  "integrations/agents/machine-readable-docs": "agents/machine-readable-docs",
  "agents/skill": "getting-started/agent-skill",
  "integrations/react-email": "ui",
  "integrations/react-email/components": "ui/components",
  "integrations/react-email/blocks": "ui",
  "ui/react-email": "ui",
  "ui/react-email/components": "ui/components",
  "ui/react-email/blocks": "ui",
  guides: "guides/schedule-email",
} as const;

export function getLatestDocsRedirect(slugs: readonly string[]) {
  return latestDocsRedirects[slugs.join("/") as keyof typeof latestDocsRedirects];
}
