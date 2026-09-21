import { describe, expect, test } from "bun:test";

import { renderComponentsAsMarkdown } from "@/lib/markdown-components";

describe("renderComponentsAsMarkdown", () => {
  test("renders a TypeTable prop as a markdown table", () => {
    const markdown = `<TypeTable
  type={{
    apiKey: {
      description: "Resend API key.",
      type: "string",
      required: true,
    },
    baseUrl: {
      description: "Override the API origin, e.g. for a proxy.",
      type: "string",
      default: '"https://api.resend.com"',
    },
  }}
/>`;

    const output = renderComponentsAsMarkdown(markdown);

    expect(output).not.toContain("<TypeTable");
    expect(output).toContain("| Option | Type | Required | Default | Description |");
    expect(output).toContain("| apiKey | `string` | Yes |  | Resend API key. |");
    expect(output).toContain(
      '| baseUrl | `string` | No | `"https://api.resend.com"` | Override the API origin, e.g. for a proxy. |',
    );
  });

  test("renders the processed quoted-prop form with entity-escaped quotes", () => {
    // getText("processed") re-serializes `type={{...}}` as `type="{...}"` and
    // entity-escapes the inner quotes.
    const markdown = `<TypeTable
  type="{
  apiKey: {
    description: &#x22;Resend API key.&#x22;,
    type: &#x22;string&#x22;,
    required: true,
  },
  baseUrl: {
    description: &#x22;Override the API origin, e.g. for a proxy.&#x22;,
    type: &#x22;string&#x22;,
    default: '&#x22;https://api.resend.com&#x22;',
  },
}"
/>`;

    const output = renderComponentsAsMarkdown(markdown);

    expect(output).not.toContain("<TypeTable");
    expect(output).toContain("| apiKey | `string` | Yes |  | Resend API key. |");
    expect(output).toContain('| baseUrl | `string` | No | `"https://api.resend.com"` |');
  });

  test("keeps type expressions containing braces inside string values", () => {
    const markdown = `<TypeTable
  type={{
    auth: {
      description: "SMTP credentials.",
      type: '{ user: string; pass: string; method?: "plain" | "login" }',
    },
  }}
/>`;

    const output = renderComponentsAsMarkdown(markdown);

    expect(output).toContain(
      '| auth | `{ user: string; pass: string; method?: "plain" \\| "login" }`',
    );
  });

  test("converts callouts to blockquotes and strips heading anchors", () => {
    const markdown = `## Verify from the CLI [#verify-from-the-cli]

<Callout type="warn" title="No metadata field">
  Resend has no metadata concept, so \`metadata\` on a message throws an
  \`EmailValidationError\` before any request is made.
</Callout>

After.`;

    const output = renderComponentsAsMarkdown(markdown);

    expect(output).toContain("## Verify from the CLI");
    expect(output).not.toContain("[#verify-from-the-cli]");
    expect(output).toContain("> **No metadata field**");
    expect(output).toContain(">   Resend has no metadata concept");
    expect(output).toContain("After.");
    expect(output).not.toContain("</Callout>");
  });

  test("quotes fences inside callouts without losing the code block", () => {
    const markdown = `<Callout type="warn" title="Credentials come from the component contract">
  A Convex component only receives the environment variables its own contract declares.
  \`\`\`ts title="convex/convex.config.ts"
  app.use(convexEmail);  \`\`\`
</Callout>`;

    const output = renderComponentsAsMarkdown(markdown);

    expect(output).toContain("> **Credentials come from the component contract**");
    expect(output).toContain('>   ```ts title="convex/convex.config.ts"');
    expect(output).toContain(">   app.use(convexEmail);  ```");
    expect(output).not.toContain("</Callout>");
  });

  test("renders tabs that share a line with a fence marker", () => {
    const markdown = `## Installation

  <Tab value="CLI">    \`\`\`bash
    npx shadcn@latest add https://email-sdk.dev/r/welcome.json    \`\`\`
  </Tab>

  <Tab value="Manual">
    Copy this template into your app.
    \`\`\`tsx title="src/ui/email/welcome.tsx"
    <ShadcnEmail preview="Your workspace is ready">
      <EmailCard />
    </ShadcnEmail>    \`\`\`
  </Tab>`;

    const output = renderComponentsAsMarkdown(markdown);

    expect(output).toContain("**CLI**");
    expect(output).toContain("**Manual**");
    expect(output).not.toContain("<Tab");
    expect(output).not.toContain("</Tab>");
    // The fenced sample code survives verbatim.
    expect(output).toContain("<ShadcnEmail preview=\"Your workspace is ready\">");
    expect(output).toContain("npx shadcn@latest add https://email-sdk.dev/r/welcome.json");
  });

  test("renders cards as list items", () => {
    const markdown = `<Card title="Install" href="/docs/getting-started/install" description="Install the SDK and confirm your runtime." />`;

    expect(renderComponentsAsMarkdown(markdown)).toContain(
      "- [Install](/docs/getting-started/install): Install the SDK and confirm your runtime.",
    );
  });

  test("renders the provider badge with the adapter identity", () => {
    const output = renderComponentsAsMarkdown(`<ProviderBadge adapter="resend" />`);

    expect(output).toContain("[Resend](https://resend.com)");
    expect(output).toContain("`@opencoredev/email-sdk/resend`");
  });

  test("renders data tables from the shared registry", () => {
    const output = renderComponentsAsMarkdown(
      `<AdapterFieldSupport />\n\n<AdapterCapabilitySupport />\n\n<ProviderGrid />`,
    );

    expect(output).toContain("| Adapter | Unsupported fields | Limits |");
    expect(output).toContain(
      "| Adapter | Repeated headers | Idempotency | Scheduling | Personalized fanout |",
    );
    expect(output).toContain("[Resend](/docs/adapters/resend)");
    expect(output).toContain("[AWS SES](/docs/adapters/ses)");
  });

  test("points archived-version mirrors at the current page for live registry data", () => {
    const output = renderComponentsAsMarkdown(`<AdapterPricing />`, {
      currentVersion: false,
    });

    expect(output).toContain("https://email-sdk.dev/docs/adapters/pricing");
    expect(output).not.toContain("| Provider | Model |");
  });

  test("leaves JSX inside fenced code blocks untouched", () => {
    const markdown =
      "```tsx\n<ShadcnEmail preview=\"Hi\">\n  <EmailCard />\n</ShadcnEmail>\n```\n\n<Card title=\"Docs\" href=\"/docs\" />";

    const output = renderComponentsAsMarkdown(markdown);

    expect(output).toContain("<ShadcnEmail");
    expect(output).toContain("- [Docs](/docs)");
  });
});
