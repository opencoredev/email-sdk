import { ADAPTER_SUPPORT_ENTRIES, ADAPTER_SUPPORT_FIELDS } from "../apps/fumadocs/src/lib/adapter-support";
import { BUILT_IN_ADAPTER_CAPABILITIES, SUPPORTED_MESSAGE_FIELDS } from "../packages/email-sdk/src/utils";

type DocsEntry = (typeof ADAPTER_SUPPORT_ENTRIES)[number];

type Field = (typeof ADAPTER_SUPPORT_FIELDS)[number];

const errors: string[] = [];

function fail(message: string) {
  errors.push(message);
}

function sameArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireIncludes(entry: DocsEntry, text: string) {
  const limits = entry.limits ?? [];
  if (!limits.some((limit) => limit.includes(text))) {
    fail(`${entry.id} is missing audited caveat containing: ${text}`);
  }
}

function entry(id: string) {
  const found = ADAPTER_SUPPORT_ENTRIES.find((candidate) => candidate.id === id);
  if (!found) fail(`Missing docs entry for ${id}.`);
  return found;
}

const sdkIds = Object.keys(SUPPORTED_MESSAGE_FIELDS);
const docsIds = ADAPTER_SUPPORT_ENTRIES.map((adapter) => adapter.id);
const duplicateIds = docsIds.filter((id, index) => docsIds.indexOf(id) !== index);

if (ADAPTER_SUPPORT_ENTRIES.length !== 23) {
  fail(`Expected 23 adapter docs entries, found ${ADAPTER_SUPPORT_ENTRIES.length}.`);
}

if (duplicateIds.length > 0) {
  fail(`Duplicate adapter docs IDs: ${[...new Set(duplicateIds)].join(", ")}.`);
}

if (!sameArray(docsIds, sdkIds)) {
  fail(`Adapter ordering or membership changed.\nDocs: ${docsIds.join(", ")}\nSDK:  ${sdkIds.join(", ")}`);
}

const expectedFields = ["cc", "bcc", "replyTo", "headers", "attachments", "tags", "metadata", "sendAt"];
if (!sameArray(ADAPTER_SUPPORT_FIELDS, expectedFields)) {
  fail(`Field ordering changed. Docs: ${ADAPTER_SUPPORT_FIELDS.join(", ")}`);
}

for (const docsEntry of ADAPTER_SUPPORT_ENTRIES) {
  const sdkFields = SUPPORTED_MESSAGE_FIELDS[docsEntry.id as keyof typeof SUPPORTED_MESSAGE_FIELDS];
  if (!sdkFields) continue;

  for (const field of ADAPTER_SUPPORT_FIELDS) {
    const docsSupports = docsEntry.fields[field] === true;
    const sdkSupports = sdkFields[field as keyof typeof sdkFields] === true;
    if (docsSupports !== sdkSupports) {
      fail(`${docsEntry.id}.${field} docs=${docsSupports} sdk=${sdkSupports}`);
    }
  }

  for (const field of Object.keys(docsEntry.fields)) {
    if (!ADAPTER_SUPPORT_FIELDS.includes(field as Field)) {
      fail(`${docsEntry.id} contains invalid field key: ${field}`);
    }
    if (docsEntry.fields[field as Field] !== true) {
      fail(`${docsEntry.id}.${field} must be represented by true or omitted.`);
    }
  }

  const sdkCapabilities = BUILT_IN_ADAPTER_CAPABILITIES[
    docsEntry.id as keyof typeof BUILT_IN_ADAPTER_CAPABILITIES
  ];
  if (!sdkCapabilities) continue;

  for (const key of ["repeatedHeaders", "idempotency", "scheduling", "personalized"] as const) {
    if (docsEntry.capabilities[key] !== sdkCapabilities[key]) {
      fail(
        `${docsEntry.id}.capabilities.${key} docs=${String(docsEntry.capabilities[key])} sdk=${String(sdkCapabilities[key])}`,
      );
    }
  }
}

const oneReplyTo = ["brevo", "cloudflare", "unosend", "sequenzy", "mailersend", "plunk", "mailtrap"];
for (const id of oneReplyTo) requireIncludes(entry(id), "one reply-to");

const oneNormalRecipient = ["iterable", "loops", "primitive"];
for (const id of oneNormalRecipient) requireIncludes(entry(id), "Normal send accepts one to recipient");

requireIncludes(entry("jetemail"), "Requires a from display name");
requireIncludes(entry("jetemail"), "50 to, 50 cc, 50 bcc, and 50 reply-to");
requireIncludes(entry("cloudflare"), "50 combined to, cc, and bcc");
requireIncludes(entry("cloudflare"), "plain strings and {email} objects are valid");
requireIncludes(entry("sequenzy"), "50 to recipients");
requireIncludes(entry("postmark"), "one tag");
requireIncludes(entry("lettermint"), "one tag");
requireIncludes(entry("mailtrap"), "one tag");
requireIncludes(entry("scaleway"), "headers already include Reply-To");
requireIncludes(entry("smtp"), "ASCII envelope addresses and header names");
requireIncludes(entry("sendgrid"), "1,000 recipients");
requireIncludes(entry("mailgun"), "1,000 recipients");
requireIncludes(entry("sendgrid"), "Tag names are discarded");
requireIncludes(entry("mailgun"), "Tag names are discarded");
requireIncludes(entry("mailersend"), "Tag names are discarded");
requireIncludes(entry("postmark"), "flattens one name:value tag");
requireIncludes(entry("mailchimp"), "yyyy-mm-dd HH:MM:ss");
requireIncludes(entry("sparkpost"), "YYYY-MM-DDTHH:mm:ss±HH:mm");

if (errors.length > 0) {
  console.error(`Adapter support docs drift check failed with ${errors.length} issue${errors.length === 1 ? "" : "s"}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Adapter support docs match SDK field and capability constants.");
