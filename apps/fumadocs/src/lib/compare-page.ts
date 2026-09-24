import {
  type ComparePair,
  getAdapterConfigSnippet,
  getComparePairTitle,
  getFallbackGaps,
  getFieldSupport,
  getProvider,
  messageFieldLabels,
  messageFields,
  type ProviderKey,
} from "./compare";
import { siteUrl } from "./shared";

export function buildCompareDescription(pair: ComparePair) {
  const a = getProvider(pair.a);
  const b = getProvider(pair.b);

  return `${a.name} vs ${b.name} for transactional email: message-field support compared side by side (attachments, scheduling, metadata, and more), with code for both via one TypeScript SDK.`;
}

export function buildCompareFaq(pair: ComparePair) {
  const a = getProvider(pair.a);
  const b = getProvider(pair.b);
  const gapsAtoB = getFallbackGaps(pair.a, pair.b);
  const gapsBtoA = getFallbackGaps(pair.b, pair.a);

  const gapAnswer =
    gapsAtoB.length > 0
      ? `${a.name} supports ${listFields(gapsAtoB)} in the unified message shape, which ${b.name} does not.`
      : `${b.name} supports every message field that ${a.name} supports, so nothing is lost moving a message from ${a.name} to ${b.name}.`;

  const fallbackAnswer =
    gapsBtoA.length === 0 && gapsAtoB.length === 0
      ? `Yes. ${a.name} and ${b.name} support the same message fields, so Email SDK can fail over between them in either direction without dropping data.`
      : `Partially. Email SDK checks field support before every send: a fallback from ${a.name} to ${b.name} is rejected for messages using ${
          gapsAtoB.length > 0 ? listFields(gapsAtoB) : "no fields"
        }${
          gapsBtoA.length > 0
            ? `, and from ${b.name} to ${a.name} for messages using ${listFields(gapsBtoA)}`
            : ""
        }. Messages that avoid those fields fail over cleanly.`;

  return [
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
- [Email DNS checker](${siteUrl}/tools/email-dns-checker): verify SPF, DKIM, and DMARC for a sending domain.
`;
}

function markField(key: ProviderKey, field: (typeof messageFields)[number]) {
  return getFieldSupport(key)[field] === true ? "Yes" : "No";
}
