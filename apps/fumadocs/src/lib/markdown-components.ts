import communityPlugins from "../../content/community/plugins.json";

import {
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
import { emailExampleCategories, emailExamples } from "./email-example-data";
import { providers } from "./providers";
import { siteUrl } from "./shared";
import { sponsors } from "./sponsors";

// The docs pages render rich JSX components (adapter data tables, provider
// grids, install tabs, callouts). fumadocs' processed markdown leaves them as
// raw JSX, so every .md mirror and llms-full.txt showed unreadable tags —
// including the config-field tables that answer "which option does this adapter
// take?". This pass substitutes markdown equivalents built from the same data
// sources the components render, so the markdown corpus carries the real
// content instead of component markup.
//
// The transform runs as a line state machine rather than a chunk split because
// the processor emits structures like `<Tab value="CLI">    ```bash` where a
// fence marker shares a line with a tag. Fenced code is never transformed:
// the JSX inside it (react-email samples) is real sample code, and these docs
// components never appear inside fences.
const FENCE_ANY = /(`{3,}|~{3,})/;
const FENCE_ALL = /(`{3,}|~{3,})/g;

export function renderComponentsAsMarkdown(
  markdown: string,
  options: { currentVersion?: boolean } = {},
) {
  const currentVersion = options.currentVersion ?? true;
  const out: string[] = [];

  let inFence = false;
  let inCallout = false;
  // A `<TypeTable>` tag spans several lines in processed output; collect until
  // the `/>` close.
  let collectingTable: string[] | null = null;

  const push = (text: string) => {
    for (const piece of text.split("\n")) {
      out.push(inCallout ? (piece.trim().length > 0 ? `> ${piece}` : ">") : piece);
    }
  };

  for (const rawLine of markdown.split("\n")) {
    if (collectingTable) {
      collectingTable.push(rawLine);
      if (rawLine.includes("/>")) {
        push(renderTypeTable(collectingTable.join("\n")));
        collectingTable = null;
      }
      continue;
    }

    if (inFence) {
      push(rawLine);
      if (FENCE_ANY.test(rawLine)) inFence = false;
      continue;
    }

    if (/<TypeTable\b/.test(rawLine) && !rawLine.includes("/>")) {
      collectingTable = [rawLine];
      continue;
    }

    // Marker parity decides the toggle: a line can open and close a fence at
    // once (`` ```code``` ``) or fuse a fence onto a tag line.
    const fenceMarks = rawLine.match(FENCE_ALL)?.length ?? 0;
    let clearCalloutAfter = false;
    const transformed = transformProseLine(rawLine, currentVersion, {
      openCallout: () => {
        inCallout = true;
      },
      closeCallout: () => {
        clearCalloutAfter = true;
      },
    });
    push(transformed);
    if (clearCalloutAfter) inCallout = false;
    if (fenceMarks % 2 === 1) inFence = true;
  }

  return out.join("\n");
}

type LineState = {
  openCallout: () => void;
  closeCallout: () => void;
};

function transformProseLine(line: string, currentVersion: boolean, state: LineState) {
  let out = line;

  out = out.replace(/<Callout\b([^>]*)>/g, (_tag, rawAttrs) => {
    state.openCallout();
    const attrs = parseStringAttrs(rawAttrs);
    const title = attrs.title ?? (attrs.type === "warn" ? "Warning" : "Note");
    return `\n**${title}**\n`;
  });
  out = out.replace(/<\/Callout>/g, () => {
    state.closeCallout();
    return "";
  });

  out = out.replace(/<Tab\b([^>]*)>/g, (_tag, rawAttrs) => {
    const { value } = parseStringAttrs(rawAttrs);
    return `\n\n**${value ?? "Option"}**\n`;
  });
  out = out.replace(/<\/Tab>/g, "");

  out = out.replace(/<Accordion\b([^>]*)>/g, (_tag, rawAttrs) => {
    const { title } = parseStringAttrs(rawAttrs);
    return `\n\n**${title ?? ""}**\n`;
  });
  out = out.replace(/<\/Accordion>/g, "");

  out = out.replace(/<TypeTable\b[^>]*?\/>/g, (tag) => renderTypeTable(tag));
  out = out.replace(/<ProviderBadge\b([^>]*)\/>/g, (_tag, attrs) =>
    renderProviderBadge(parseStringAttrs(attrs)),
  );
  out = out.replace(/<Card\b([^>]*)\/>/g, (_tag, attrs) =>
    renderCard(parseStringAttrs(attrs)),
  );
  out = out.replace(/<PackageInstallTabs\b([^>]*)\/>/g, (_tag, attrs) =>
    renderPackageInstall(parseStringAttrs(attrs)),
  );
  out = out.replace(/<EmailExample\b([^>]*)\/>/g, (_tag, attrs) =>
    renderEmailExample(parseStringAttrs(attrs), currentVersion),
  );

  // Data-driven blocks mirror live registry data. On archived version pages
  // that data describes the current SDK, not the archived one, so the mirror
  // links to the current page instead of rendering stale rows.
  const liveLink = (docsPath: string) =>
    `The live version of this content is at ${siteUrl}${docsPath}.`;

  const dataComponents: [RegExp, string, () => string][] = [
    [/<ProviderGrid\b[^>]*\/>/g, "/docs/adapters", renderProviderGrid],
    [/<AdapterFieldSupport\b[^>]*\/>/g, "/docs/adapters/field-support", renderFieldSupport],
    [/<AdapterCapabilitySupport\b[^>]*\/>/g, "/docs/adapters/capability-groups", renderCapabilitySupport],
    [/<AdapterPricing\b[^>]*\/>/g, "/docs/adapters/pricing", renderPricing],
    [/<AdapterVerification\b[^>]*\/>/g, "/docs/adapters/verification", renderVerification],
    [/<CommunityPluginRegistry\b[^>]*\/>/g, "/docs/plugins/community", renderCommunityRegistry],
    [/<EmailExampleGallery\b[^>]*\/>/g, "/docs/ui", renderEmailGallery],
    [/<SponsorSpotlight\b[^>]*\/>/g, "/docs/adapters", renderSponsorSpotlight],
  ];
  for (const [pattern, docsPath, render] of dataComponents) {
    out = out.replace(pattern, () => (currentVersion ? render() : liveLink(docsPath)));
  }

  // Wrappers whose children already carry the markdown: drop the tags.
  out = out.replace(/<\/?(?:Cards|Steps|Step|Tabs|Accordions)\b[^>]*>/g, "");

  // fumadocs appends a heading anchor as nonstandard `[#slug]` syntax, which
  // reads like a broken link to anything parsing the markdown as CommonMark.
  out = out.replace(/^(#{1,6}\s+.*?)\s*\[#[^\]\n]+\][ \t]*$/, "$1");

  return out;
}

type Attrs = Record<string, string>;

// The processor entity-escapes prop values (`&#x22;` for quotes), so every
// string attribute goes through this before use.
function decodeEntities(value: string) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseStringAttrs(source: string): Attrs {
  const attrs: Attrs = {};
  const pattern = /(\w+)="([^"]*)"|(\w+)='([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    attrs[match[1] ?? match[3]] = decodeEntities(match[2] ?? match[4]);
  }
  return attrs;
}

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

// region TypeTable

type TypeTableField = {
  name: string;
  description?: string;
  type?: string;
  required?: boolean;
  default?: string;
};

// Reads the `type` prop without evaluating the object literal: the literal is
// scanned, so a malformed or surprising value leaves the tag as-is rather than
// executing content. Source MDX writes `type={{ ... }}`; processed markdown
// re-serializes the prop as the quoted form `type="{ ... }"` with the inner
// quotes entity-escaped — both unwrap to the same `{ ... }` field map.
function renderTypeTable(tag: string) {
  const typeIndex = tag.indexOf("type=");
  if (typeIndex === -1) return tag;

  const valueStart = typeIndex + "type=".length;
  const delimiter = tag[valueStart];
  let objectLiteral: string;

  if (delimiter === "{") {
    const captured = captureBalanced(tag, valueStart, "{", "}");
    if (!captured) return tag;
    objectLiteral = decodeEntities(captured.text.slice(1, -1)).trim();
  } else if (delimiter === '"' || delimiter === "'") {
    const end = skipString(tag, valueStart);
    if (end === -1) return tag;
    objectLiteral = decodeEntities(tag.slice(valueStart + 1, end - 1)).trim();
  } else {
    return tag;
  }

  if (!objectLiteral.startsWith("{") || !objectLiteral.endsWith("}")) return tag;

  const fields = parseFieldEntries(objectLiteral.slice(1, -1));
  if (fields.length === 0) return tag;

  const anyRequired = fields.some((field) => field.required === true);
  const anyDefault = fields.some((field) => field.default !== undefined);

  const header = ["Option", "Type"];
  if (anyRequired) header.push("Required");
  if (anyDefault) header.push("Default");
  header.push("Description");

  const rows = fields.map((field) => {
    const cells = [field.name, field.type ? `\`${field.type}\`` : ""];
    if (anyRequired) cells.push(field.required ? "Yes" : "No");
    if (anyDefault) cells.push(field.default !== undefined ? `\`${field.default}\`` : "");
    cells.push(field.description ?? "");
    return `| ${cells.map(escapeCell).join(" | ")} |`;
  });

  return `\n\n| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |\n${rows.join("\n")}\n\n`;
}

// Capture the text between src[start] (must be `open`) and its matching `close`,
// skipping over string literals so braces inside strings do not count.
function captureBalanced(src: string, start: number, open: string, close: string) {
  let depth = 0;
  let i = start;

  while (i < src.length) {
    const char = src[i];

    if (char === '"' || char === "'" || char === "`") {
      const end = skipString(src, i);
      if (end === -1) return undefined;
      i = end;
      continue;
    }

    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return { text: src.slice(start, i + 1), end: i + 1 };
    }
    i += 1;
  }

  return undefined;
}

function skipString(src: string, start: number) {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === quote) return i + 1;
    i += 1;
  }
  return -1;
}

// Splits `{ apiKey: { description: "..." }, baseUrl: { ... } }` contents into
// per-field records. Entry keys may be bare identifiers or quoted strings.
function parseFieldEntries(src: string): TypeTableField[] {
  const fields: TypeTableField[] = [];
  let i = 0;

  while (i < src.length) {
    i = skipSeparators(src, i);
    if (i >= src.length) break;

    const key = readKey(src, i);
    if (!key) break;
    i = key.end;

    i = skipWhitespace(src, i);
    if (src[i] !== ":") break;
    i = skipWhitespace(src, i + 1);

    if (src[i] !== "{") break;
    const body = captureBalanced(src, i, "{", "}");
    if (!body) break;
    i = body.end;

    fields.push({ name: key.name, ...parseFieldProps(body.text.slice(1, -1)) });
  }

  return fields;
}

// Reads `description: "...", type: "string", required: true` style entries.
// Values are string literals, booleans, numbers, or bare type expressions.
function parseFieldProps(src: string) {
  const props: Partial<TypeTableField> = {};

  let i = 0;
  while (i < src.length) {
    i = skipSeparators(src, i);
    if (i >= src.length) break;

    const key = readKey(src, i);
    if (!key) break;
    i = key.end;

    i = skipWhitespace(src, i);
    if (src[i] !== ":") break;
    i = skipWhitespace(src, i + 1);

    const value = readValue(src, i);
    if (!value) break;
    i = value.end;

    if (key.name === "description") props.description = value.value;
    else if (key.name === "type") props.type = value.value;
    else if (key.name === "required") props.required = value.value === "true";
    else if (key.name === "default") props.default = value.value;
  }

  return props;
}

function skipWhitespace(src: string, i: number) {
  while (i < src.length && /\s/.test(src[i])) i += 1;
  return i;
}

function skipSeparators(src: string, i: number) {
  while (i < src.length && /[\s,]/.test(src[i])) i += 1;
  return i;
}

function readKey(src: string, i: number) {
  const char = src[i];
  if (char === '"' || char === "'" || char === "`") {
    const end = skipString(src, i);
    if (end === -1) return undefined;
    return { name: src.slice(i + 1, end - 1), end };
  }
  const match = /^[A-Za-z_$][\w$-]*/.exec(src.slice(i));
  if (!match) return undefined;
  return { name: match[0], end: i + match[0].length };
}

function readValue(src: string, i: number) {
  const char = src[i];
  if (char === '"' || char === "'" || char === "`") {
    const end = skipString(src, i);
    if (end === -1) return undefined;
    return { value: src.slice(i + 1, end - 1), end };
  }
  // Bare value (boolean, number, identifier): runs to the next `,` at depth 0.
  let end = i;
  while (end < src.length && src[end] !== "," && src[end] !== "}") end += 1;
  return { value: src.slice(i, end).trim(), end };
}

// endregion

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

function capabilityValue(capabilities: AdapterSupportCapabilities, key: keyof AdapterSupportCapabilities) {
  const value = capabilities[key];

  if (key === "repeatedHeaders" || key === "scheduling") return value ? "Yes" : "No";
  if (key === "idempotency") {
    if (value === "message_id") return "Message-ID";
    return value === "native" ? "Native" : "None";
  }
  return value === "native" ? "Native" : "Expanded";
}

const sponsorNames = new Set(sponsors.map((sponsor) => sponsor.name));
const liveCheckIds = new Set(verificationRows().filter((row) => row.check).map((row) => row.id));

function renderProviderBadge(attrs: Attrs) {
  const provider = providers.find((item) => item.key === attrs.adapter);
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
        ? "All normalized fields"
        : unsupported.map((field) => FIELD_LABELS[field]).join(", ");
    const limitsCell = (entry.limits ?? []).join("; ");
    return `| [${entry.label}](${entry.setupHref}) | ${unsupportedCell} | ${limitsCell} |`;
  });

  return `\n\n${ADAPTER_SUPPORT_TOTAL_LABEL}. The ordered fields are ${ADAPTER_SUPPORT_FIELDS.map((field) => FIELD_LABELS[field]).join(", ")}.\n\n| Adapter | Unsupported fields | Limits |\n| --- | --- | --- |\n${rows.join("\n")}\n\n`;
}

function renderCapabilitySupport() {
  const capabilityKeys = Object.keys(CAPABILITY_LABELS) as (keyof AdapterSupportCapabilities)[];
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
      const sources = row.sources
        .map((source) => `[${source.label}](${source.href})`)
        .join(", ");
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

type CommunityEntry = {
  name: string;
  package: string;
  kind: string;
  status: string;
  description: string;
  href: string;
  repo: string;
  maintainer: string;
};

function renderCommunityRegistry() {
  const entries = communityPlugins as CommunityEntry[];
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
  const packageName = attrs.packageName ?? "@opencoredev/email-sdk";

  return `\n\n\`\`\`bash\nnpm install ${packageName}\nbun add ${packageName}\npnpm add ${packageName}\nyarn add ${packageName}\n\`\`\`\n\n`;
}

function renderCard(attrs: Attrs) {
  const { title, href, description } = attrs;
  if (!title || !href) return "";
  return `- [${title}](${href})${description ? `: ${description}` : ""}`;
}

function renderSponsorSpotlight() {
  const list = sponsors.map((sponsor) => `[${sponsor.name}](${sponsor.href})`).join(", ");
  return `\n\nSponsored by ${list}.\n\n`;
}

function renderEmailExample(attrs: Attrs, currentVersion: boolean) {
  const example = emailExamples[attrs.id as keyof typeof emailExamples];
  if (!example) return "";

  const header = `**Email preview: ${example.title}.** Subject: "${example.subject}". Preview text: "${example.preview}".`;
  const pointer = currentVersion
    ? "The rendered email is on the HTML version of this page."
    : `The rendered email is at ${siteUrl}${example.path}.`;

  return `\n\n${header} ${pointer}\n\n`;
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
