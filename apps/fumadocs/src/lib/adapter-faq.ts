import {
  ADAPTER_SUPPORT_ENTRIES,
  ADAPTER_SUPPORT_FIELDS,
  type AdapterSupportEntry,
  type AdapterSupportField,
  getUnsupportedFields,
} from "./adapter-support";
import { messageFieldLabels } from "./compare";
import { providers } from "./providers";

const listFormatter = new Intl.ListFormat("en", {
  style: "long",
  type: "conjunction",
});

function listFieldLabels(fields: readonly AdapterSupportField[]) {
  return listFormatter.format(fields.map((field) => messageFieldLabels[field]));
}

export function getAdapterSupportEntry(docsPath: string): AdapterSupportEntry | undefined {
  const match = /^adapters\/([^/]+)\.mdx$/.exec(docsPath);
  if (!match) return undefined;
  return ADAPTER_SUPPORT_ENTRIES.find((entry) => entry.id === match[1]);
}

export function buildAdapterFaq(entry: AdapterSupportEntry) {
  const provider = providers.find((candidate) => candidate.key === entry.id);
  const supported = ADAPTER_SUPPORT_FIELDS.filter((field) => entry.fields[field] === true);
  const unsupported = getUnsupportedFields(entry);
  const idempotencyAnswer = {
    native: `Yes. The ${entry.label} adapter passes an idempotency key to the provider, so ${entry.label} deduplicates repeated sends on its side.`,
    message_id: `Partially. The ${entry.label} adapter derives a stable Message-ID from the idempotency key, but the receiving server decides whether to deduplicate.`,
    none: `No. ${entry.label} has no provider-side idempotency, so a retried send can be delivered twice. Deduplicate in your own queue before retrying.`,
  }[entry.capabilities.idempotency];

  return [
    {
      question: `Does Email SDK support ${entry.label}?`,
      answer: `Yes. Email SDK ships a ${entry.label} adapter${
        provider ? ` imported from ${provider.importPath}` : ""
      }. You keep your ${entry.label} account and credentials; the SDK adds message validation, typed errors, and no-network test adapters around the same send() call used for every other provider.`,
    },
    {
      question: `Which message fields does the ${entry.label} adapter support?`,
      answer:
        unsupported.length > 0
          ? `${entry.label} supports ${listFieldLabels(supported)}. It does not support ${listFieldLabels(unsupported)}; Email SDK rejects a message that uses those fields before any request is made.`
          : `${entry.label} supports every normalized message field: ${listFieldLabels(supported)}.`,
    },
    {
      question: `Can ${entry.label} schedule email for later with Email SDK?`,
      answer: entry.capabilities.scheduling
        ? `Yes. Set sendAt on the message and the ${entry.label} adapter passes the scheduled time to the provider.`
        : `No. ${entry.label} has no provider-side scheduling, so a message with sendAt fails validation. Store the job in your own queue and send when it is due.`,
    },
    {
      question: `Does the ${entry.label} adapter support idempotent sends?`,
      answer: idempotencyAnswer,
    },
  ];
}
