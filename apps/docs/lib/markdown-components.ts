import type { ComponentMarkdown, ComponentMarkdownContext } from "blume";

import communityPlugins from "../content/community/plugins.json" with { type: "json" };
import { communityEntrySchema } from "./community-registry";

import { z } from "zod";

import {
  ADAPTER_CAPABILITY_KEYS,
  ADAPTER_SUPPORT_ENTRIES,
  ADAPTER_SUPPORT_FIELDS,
  ADAPTER_SUPPORT_TOTAL_LABEL,
  type AdapterSupportCapabilities,
  type AdapterSupportEntry,
  getUnsupportedFields,
} from "./adapter-support";
import {
  adapterPricing,
  formatPrice,
  formatPricingVolume,
  pricingVolumes,
} from "./adapter-pricing";
import { EVIDENCE_KINDS, evidenceState, verificationRows } from "./adapter-verification";
import { emailExampleCategories, emailExamples, isEmailExampleId } from "./email-example-data";
import { providers } from "./providers";
import { siteUrl } from "./shared";
import { sponsors } from "./sponsors";

// The docs pages render data-driven components (adapter tables, provider
// grids, install tabs). Blume serves every page as Markdown too (.md mirrors,
// llms-full.txt, the MCP server); these serializers give each component a
// Markdown form built from the same data sources the components render, so
// agents read the real content instead of a bare JSX tag.

type Attrs = ReadonlyMap<string, string>;

const stringProps = z.record(z.string(), z.unknown());

function attrsOf(props: ComponentMarkdownContext["props"]): Attrs {
  const attrs = new Map<string, string>();

  for (const [key, value] of Object.entries(stringProps.parse(props))) {
    const parsed = z.string().safeParse(value);

    if (parsed.success) attrs.set(key, parsed.data);
  }

  return attrs;
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

// Data-driven blocks render live registry data. Archived snapshots pass a
// `release` prop, and on those pages the data describes the current SDK, not
// the archived one, so the mirror links to the current page instead of
// printing current rows under an old release URL.
function currentData(docsPath: string, render: () => string): ComponentMarkdown {
  return ({ props }) =>
    attrsOf(props).has("release")
      ? `\n\nThe live version of this content is at ${siteUrl}${docsPath}.\n\n`
      : render();
}

export const markdownComponents = {
  AdapterCapabilitySupport: currentData("/docs/adapters/capability-groups", () =>
    renderCapabilitySupport(),
  ),
  AdapterFieldSupport: currentData("/docs/adapters/field-support", () => renderFieldSupport()),
  AdapterPricing: currentData("/docs/adapters/pricing", () => renderPricing()),
  AdapterVerification: currentData("/docs/adapters/verification", () => renderVerification()),
  CommunityPluginRegistry: currentData("/docs/plugins/community", () =>
    renderCommunityRegistry(),
  ),
  EmailExample: ({ props }) => renderEmailExample(attrsOf(props)),
  EmailExampleGallery: currentData("/docs/ui", () => renderEmailGallery()),
  PackageInstallTabs: ({ props }) => renderPackageInstall(attrsOf(props)),
  ProviderBadge: ({ props }) => renderProviderBadge(attrsOf(props)),
  ProviderGrid: currentData("/docs/adapters", () => renderProviderGrid()),
  SponsorSpotlight: currentData("/docs/adapters", () => renderSponsorSpotlight()),
} satisfies Record<string, ComponentMarkdown>;

// region adapters

const FIELD_LABELS: Record<(typeof ADAPTER_SUPPORT_FIELDS)[number], string> = {
  cc: "CC",
  bcc: "BCC",
  replyTo: "Reply-to",
  headers: "Headers",
  attachments: "Attachments",
  tags: "Tags",
  metadata: "Metadata",
  sendAt: "Send at",
};

const CAPABILITY_LABELS: Record<keyof AdapterSupportCapabilities, string> = {
  repeatedHeaders: "Repeated headers",
  idempotency: "Idempotency",
  scheduling: "Scheduling",
  personalized: "Personalized fanout",
};

function capabilityValue(
  capabilities: AdapterSupportCapabilities,
  key: keyof AdapterSupportCapabilities,
) {
  const value = capabilities[key];

  if (key === "repeatedHeaders" || key === "scheduling") return value ? "Yes" : "No";

  if (key === "idempotency") {
    if (value === "message_id") return "Message-ID";

    return value === "native" ? "Native" : "None";
  }

  return value === "native" ? "Native" : "Expanded";
}

const sponsorNames = new Set(sponsors.map((sponsor) => sponsor.name));

const liveCheckIds = new Set(
  verificationRows()
    .filter((row) => row.check)
    .map((row) => row.id),
);

function renderProviderBadge(attrs: Attrs) {
  const provider = providers.find((item) => item.key === attrs.get("adapter"));

  if (!provider) return "";

  const notes = [
    sponsorNames.has(provider.name) ? "Sponsor" : undefined,
    liveCheckIds.has(provider.key) ? "[live check](/docs/adapters/verification)" : undefined,
  ].filter(Boolean);

  return `\n\n**[${provider.name}](${provider.website})** · \`${provider.importPath}\` · [setup guide](${provider.docs})${notes.length > 0 ? ` · ${notes.join(" · ")}` : ""}\n\n`;
}

function renderProviderGrid() {
  const items = providers.map(
    (provider) =>
      `- [${provider.name}](${provider.docs}) (\`${provider.importPath}\`, [provider site](${provider.website}))${sponsorNames.has(provider.name) ? " — sponsor" : ""}${liveCheckIds.has(provider.key) ? " — [live check](/docs/adapters/verification)" : ""}: ${provider.summary}`,
  );

  return `\n\n${items.join("\n")}\n\n`;
}

function renderFieldSupport() {
  const rows = ADAPTER_SUPPORT_ENTRIES.map((entry: AdapterSupportEntry) => {
    const unsupported = getUnsupportedFields(entry);

    const unsupportedCell =
      unsupported.length === 0
        ? "None"
        : unsupported.map((field) => FIELD_LABELS[field]).join(", ");

    const limitsCell = (entry.limits ?? []).join("; ");

    return `| [${entry.label}](${entry.setupHref}) | ${unsupportedCell} | ${limitsCell} |`;
  });

  return `\n\n${ADAPTER_SUPPORT_TOTAL_LABEL}. The ordered fields are ${ADAPTER_SUPPORT_FIELDS.map((field) => FIELD_LABELS[field]).join(", ")}.\n\n| Adapter | Unsupported fields | Limits |\n| --- | --- | --- |\n${rows.join("\n")}\n\n`;
}

function renderCapabilitySupport() {
  const capabilityKeys = ADAPTER_CAPABILITY_KEYS;

  const rows = ADAPTER_SUPPORT_ENTRIES.map(
    (entry) =>
      `| [${entry.label}](${entry.setupHref}) | ${capabilityKeys.map((key) => capabilityValue(entry.capabilities, key)).join(" | ")} |`,
  );

  return `\n\nDelivery behavior by built-in adapter. Unsupported message fields still fail field validation first.\n\n| Adapter | ${capabilityKeys.map((key) => CAPABILITY_LABELS[key]).join(" | ")} |\n| --- | ${capabilityKeys.map(() => "---").join(" | ")} |\n${rows.join("\n")}\n\n`;
}

function renderPricing() {
  const header = `| Provider | Model | ${pricingVolumes.map(formatPricingVolume).join(" | ")} |`;
  const separator = `| --- | --- | ${pricingVolumes.map(() => "---").join(" | ")} |`;

  const rows = adapterPricing.map(
    (row) =>
      `| [${row.provider.name}](${row.provider.docs}) | ${row.model} | ${row.prices.map(formatPrice).join(" | ")} |`,
  );

  const notes = adapterPricing
    .map((row) => {
      const sources = row.sources.map((source) => `[${source.label}](${source.href})`).join(", ");

      return `- ${row.provider.name}: ${row.note} Source: ${sources}.`;
    })
    .join("\n");

  return `\n\nMonthly prices at the listed volumes, from each provider's published pricing. Values retain their listed USD or EUR currency. Free tiers are included where they apply to transactional sends.\n\n${header}\n${separator}\n${rows.join("\n")}\n\n### Pricing notes\n\n${notes}\n\n`;
}

const EVIDENCE_COLUMN_LABELS: Record<(typeof EVIDENCE_KINDS)[number], string> = {
  "contract-test": "Contract tests",
  "auth-probe-configured": "Configured auth probe",
  "auth-check": "Dated auth check",
  "send-verified": "Verified send",
  "delivery-verified": "Verified delivery",
};

function renderVerification() {
  const rows = verificationRows();
  const configured = rows.filter((row) => row.check).length;

  const published = rows.reduce(
    (count, row) => count + Object.values(row.evidence).filter(Boolean).length,
    0,
  );

  const lines = rows.map((row) => {
    const cells = EVIDENCE_KINDS.map((kind) => {
      if (kind === "contract-test") {
        return row.contractTestFiles.length > 0 ? row.contractTestFiles.join(", ") : "None";
      }

      if (kind === "auth-probe-configured") {
        return row.check ? `Configured: ${row.check.probe}` : "Not configured";
      }

      const record = row.evidence[kind];

      return record ? `${evidenceState(record)} (${record.timestamp.slice(0, 10)})` : "None";
    });

    return `| [${row.label}](${row.setupHref}) | ${cells.map(escapeCell).join(" | ")} |`;
  });

  return `\n\n${rows.length} adapters · ${configured} configured auth probes · ${published} published run records. A configured test or probe is configuration, not a passing result. Published records older than 30 days are marked stale.\n\n| Adapter | ${EVIDENCE_KINDS.map((kind) => EVIDENCE_COLUMN_LABELS[kind]).join(" | ")} |\n| --- | ${EVIDENCE_KINDS.map(() => "---").join(" | ")} |\n${lines.join("\n")}\n\n`;
}

// endregion

// region other components

function renderCommunityRegistry() {
  const entries = z.array(communityEntrySchema).parse(communityPlugins);

  if (entries.length === 0) {
    return "No community plugins are listed yet. Community packages are listed by pull request after their registry entry passes the static checks.";
  }

  const items = entries.map(
    (entry) =>
      `- [${entry.name}](${entry.href}) (\`${entry.package}\`, ${entry.kind}, ${entry.status}): ${entry.description} Maintained by [${entry.maintainer}](${entry.repo}).`,
  );

  return `\n\n${items.join("\n")}\n\n`;
}

function renderPackageInstall(attrs: Attrs) {
  const packageName = attrs.get("packageName") ?? "@opencoredev/email-sdk";

  return `\n\n\`\`\`bash\nnpm install ${packageName}\nbun add ${packageName}\npnpm add ${packageName}\nyarn add ${packageName}\n\`\`\`\n\n`;
}

function renderSponsorSpotlight() {
  const list = sponsors.map((sponsor) => `[${sponsor.name}](${sponsor.href})`).join(", ");

  return `\n\nSponsored by ${list}.\n\n`;
}

function renderEmailExample(attrs: Attrs) {
  const id = attrs.get("id");

  if (!id || !isEmailExampleId(id)) return "";
  const example = emailExamples[id];

  const header = `**Email preview: ${example.title}.** Subject: "${example.subject}". Preview text: "${example.preview}".`;

  return `\n\n${header} The rendered email is at ${siteUrl}${example.path}.\n\n`;
}

function renderEmailGallery() {
  const sections = emailExampleCategories.map((category) => {
    const items = Object.entries(emailExamples)
      .filter(([, example]) => example.category === category.key)
      .map(([, example]) => `- [${example.title}](${example.path}): ${example.description}`);

    return `### ${category.title}\n\n${items.join("\n")}`;
  });

  return `\n\n${sections.join("\n\n")}\n\n`;
}

// endregion
