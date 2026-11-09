import {
  type ComparePair,
  getAdapterConfigSnippet,
  getComparePairTitle,
  getFallbackGaps,
  getFieldSupport,
  getProvider,
  getProviderBlogGuides,
  messageFieldLabels,
  messageFields,
  type ProviderKey,
} from "./compare";
import { ADAPTER_SUPPORT_ENTRIES } from "./adapter-support";
import { siteUrl } from "./shared";

/** Page <title> before the site-name suffix: the pair's search title, or the shared template. */
export function buildComparePageTitle(pair: ComparePair) {
  return pair.search?.title ?? `${getComparePairTitle(pair)}: transactional email API comparison`;
}

export function buildCompareDescription(pair: ComparePair) {
  if (pair.search) return pair.search.description;

  const a = getProvider(pair.a);
  const b = getProvider(pair.b);

  return `${a.name} vs ${b.name} for transactional email: message-field support compared side by side (attachments, scheduling, metadata, and more), with code for both via one TypeScript SDK.`;
}

export function buildCompareFaq(pair: ComparePair) {
  const a = getProvider(pair.a);
  const b = getProvider(pair.b);
  const gapsAtoB = getFallbackGaps(pair.a, pair.b);

  const gapAnswer =
    gapsAtoB.length > 0
      ? `${a.name} supports ${listFields(gapsAtoB)} in the unified message shape, which ${b.name} does not.`
      : `${b.name} supports every message field that ${a.name} supports, so nothing is lost moving a message from ${a.name} to ${b.name}.`;

  const restrictionsAtoB = getFallbackRestrictions(pair.a, pair.b);
  const restrictionsBtoA = getFallbackRestrictions(pair.b, pair.a);

  const rejectedDirections = [
    ...(restrictionsAtoB.length > 0
      ? [`from ${a.name} to ${b.name} for messages using ${restrictionsAtoB.join(", ")}`]
      : []),
    ...(restrictionsBtoA.length > 0
      ? [`from ${b.name} to ${a.name} for messages using ${restrictionsBtoA.join(", ")}`]
      : []),
  ];

  const limits = [
    ...getAdapterLimits(pair.a).map((limit) => `${a.name}: ${limit}`),
    ...getAdapterLimits(pair.b).map((limit) => `${b.name}: ${limit}`),
  ];

  const limitsNote =
    limits.length > 0
      ? ` Adapter limits also apply. ${limits.join(" ")}`
      : "";

  const fallbackAnswer =
    rejectedDirections.length === 0
      ? `Yes. ${a.name} and ${b.name} support the same message fields, so Email SDK's field checks pass a fallback in either direction.${limitsNote}`
      : `Partially. Email SDK checks field support before every send: a fallback is rejected ${rejectedDirections.join(
          ", and ",
        )}. Messages that avoid those fail over cleanly.${limitsNote}`;

  const verdict = pair.search
    ? [{ question: `Should I use ${a.name} or ${b.name}?`, answer: pair.search.verdict }]
    : [];

  return [
    ...verdict,
    {
      question: `Can I switch from ${a.name} to ${b.name} without rewriting my email code?`,
      answer: `Yes. With Email SDK both providers share one typed send() call and one message shape, so switching from ${a.name} to ${b.name} is a one-line adapter change plus an API key. The SDK fails fast if a message uses a field ${b.name} does not support, so nothing is silently dropped.`,
    },
    {
      question: `Which message fields does ${a.name} support that ${b.name} doesn't?`,
      answer: gapAnswer,
    },
    {
      question: `Can I use ${b.name} as a fallback for ${a.name}?`,
      answer: fallbackAnswer,
    },
  ];
}

export function sendSnippet(key: ProviderKey, importPath: string) {
  return `import { createEmailClient } from "@opencoredev/email-sdk";
import { ${key} } from "${importPath}";

const client = createEmailClient({
  adapters: [${getAdapterConfigSnippet(key)}],
});

await client.send({
  from: "hello@yourdomain.com",
  to: "user@example.com",
  subject: "Welcome!",
  html: "<p>It works.</p>",
});`;
}

export function fallbackSnippet(pair: ComparePair, importPathA: string, importPathB: string) {
  return `import { createEmailClient } from "@opencoredev/email-sdk";
import { ${pair.a} } from "${importPathA}";
import { ${pair.b} } from "${importPathB}";

const client = createEmailClient({
  adapters: [
    ${getAdapterConfigSnippet(pair.a)},
    ${getAdapterConfigSnippet(pair.b)},
  ],
  defaultAdapter: "${pair.a}",
  fallback: ["${pair.b}"],
});`;
}

/**
 * What a fallback from one adapter to another rejects: message fields the target
 * lacks, plus repeated header names when only the source accepts them.
 */
function getFallbackRestrictions(from: ProviderKey, to: ProviderKey) {
  const restrictions = getFallbackGaps(from, to).map((field) => messageFieldLabels[field]);

  if (supportsRepeatedHeaders(from) && !supportsRepeatedHeaders(to)) {
    restrictions.push("repeated header names");
  }

  return restrictions;
}

function getAdapterSupportEntry(key: ProviderKey) {
  return ADAPTER_SUPPORT_ENTRIES.find((entry) => entry.id === key);
}

function supportsRepeatedHeaders(key: ProviderKey) {
  return getAdapterSupportEntry(key)?.capabilities.repeatedHeaders === true;
}

function getAdapterLimits(key: ProviderKey): readonly string[] {
  const entry = getAdapterSupportEntry(key);

  return entry && "limits" in entry ? entry.limits : [];
}

export function listFields(fields: ReturnType<typeof getFallbackGaps>) {
  return fields.map((field) => messageFieldLabels[field]).join(", ");
}

// Markdown mirror of /compare/<pair> served at <url>.md. Answer engines and
// coding agents get the same field matrix, fallback analysis, code, and FAQ as
// plain markdown instead of having to parse the rendered page.
export function renderCompareMarkdown(pair: ComparePair) {
  const a = getProvider(pair.a);
  const b = getProvider(pair.b);
  const title = getComparePairTitle(pair);
  const canonicalUrl = `${siteUrl}/compare/${pair.slug}`;
  const gapsAtoB = getFallbackGaps(pair.a, pair.b);
  const gapsBtoA = getFallbackGaps(pair.b, pair.a);
  const faq = buildCompareFaq(pair);

  const table = [
    `| Message field | ${a.name} | ${b.name} |`,
    "| --- | --- | --- |",
    ...messageFields.map(
      (field) =>
        `| ${messageFieldLabels[field]} | ${markField(pair.a, field)} | ${markField(pair.b, field)} |`,
    ),
  ].join("\n");

  const fallbackSection =
    gapsAtoB.length === 0 && gapsBtoA.length === 0
      ? `${a.name} and ${b.name} support identical message fields, so Email SDK can fail over between them in either direction without losing data.`
      : [
          gapsAtoB.length > 0
            ? `Failing over from ${a.name} to ${b.name} loses: ${listFields(gapsAtoB)}. Email SDK rejects the fallback send for messages that use these fields instead of dropping them silently.`
            : undefined,
          gapsBtoA.length > 0
            ? `Failing over from ${b.name} to ${a.name} loses: ${listFields(gapsBtoA)}.`
            : undefined,
        ]
          .filter(Boolean)
          .join("\n\n");

  return `# ${title}

> ${buildCompareDescription(pair)}

Canonical page: ${canonicalUrl}
${pair.search ? `\n**Short answer:** ${pair.search.verdict}\n` : ""}
${pair.intro}

## Message field support

Field support as encoded in Email SDK's own adapter capability matrix, the same data the SDK uses to reject sends that would silently drop fields.

${table}

## Fallback compatibility

${fallbackSection}

## Same code, either provider

With Email SDK the send call is identical for both providers; only the adapter import changes.

\`\`\`ts
${sendSnippet(pair.a, a.importPath)}
\`\`\`

Or run both, with automatic fallback:

\`\`\`ts
${fallbackSnippet(pair, a.importPath, b.importPath)}
\`\`\`

## Frequently asked questions

${faq.map((entry) => `### ${entry.question}\n\n${entry.answer}`).join("\n\n")}

## Adapter docs

- [${a.name} adapter](${siteUrl}${a.docs})
- [${b.name} adapter](${siteUrl}${b.docs})
${getProviderBlogGuides(pair)
  .map((guide) => `- [${guide.title}](${siteUrl}/blog/${guide.slug})\n`)
  .join("")}- [Email DNS checker](${siteUrl}/tools/email-dns-checker): verify SPF, DKIM, and DMARC for a sending domain.
`;
}

function markField(key: ProviderKey, field: (typeof messageFields)[number]) {
  return getFieldSupport(key)[field] === true ? "Yes" : "No";
}
