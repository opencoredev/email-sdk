import {
  ADAPTER_SUPPORT_ENTRIES,
  ADAPTER_SUPPORT_FIELDS,
  ADAPTER_SUPPORT_TOTAL_LABEL,
  getUnsupportedFields,
  type AdapterSupportCapabilities,
  type AdapterSupportEntry,
  type AdapterSupportField,
} from "@/lib/adapter-support";

const FIELD_LABELS = {
  cc: "CC",
  bcc: "BCC",
  replyTo: "Reply-to",
  headers: "Headers",
  attachments: "Attachments",
  tags: "Tags",
  metadata: "Metadata",
  sendAt: "Send at",
} satisfies Record<AdapterSupportField, string>;

const CAPABILITY_LABELS = {
  repeatedHeaders: "Repeated headers",
  idempotency: "Idempotency",
  scheduling: "Scheduling",
  personalized: "Personalized fanout",
} satisfies Record<keyof AdapterSupportCapabilities, string>;

function fieldList(fields: readonly AdapterSupportField[]) {
  return fields.map((field) => FIELD_LABELS[field]).join(", ");
}

function capabilityValue(capabilities: AdapterSupportCapabilities, key: keyof AdapterSupportCapabilities) {
  const value = capabilities[key];

  if (key === "repeatedHeaders" || key === "scheduling") {
    return value === true ? "Yes" : "No";
  }

  if (key === "idempotency") {
    if (value === "message_id") return "Message-ID";
    return value === "native" ? "Native" : "None";
  }

  return value === "native" ? "Native" : "Expanded";
}

function UnsupportedFields({ entry }: { entry: AdapterSupportEntry }) {
  const unsupported = getUnsupportedFields(entry);

  if (unsupported.length === 0) {
    return <span className="text-fd-muted-foreground">All normalized fields</span>;
  }

  return (
    <span>
      <span className="font-medium text-fd-foreground">Not supported:</span>{" "}
      <span className="text-fd-muted-foreground">{fieldList(unsupported)}</span>
    </span>
  );
}

function AdapterSupportRow({ entry }: { entry: AdapterSupportEntry }) {
  return (
    <div className="border-fd-border border-t py-4 first:border-t-0">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 md:w-64 md:shrink-0">
          <a className="font-medium text-fd-foreground underline-offset-4 hover:underline" href={entry.setupHref}>
            {entry.label}
          </a>
        </div>
        <div className="min-w-0 flex-1 space-y-2 text-sm leading-6">
          <div>
            <UnsupportedFields entry={entry} />
          </div>
          {entry.limits && entry.limits.length > 0 ? (
            <ul className="space-y-1 text-fd-muted-foreground">
              {entry.limits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function AdapterFieldSupport() {
  return (
    <section className="my-6 rounded-xl border border-fd-border bg-fd-card/40">
      <div className="border-fd-border border-b px-4 py-3 text-sm text-fd-muted-foreground">
        {ADAPTER_SUPPORT_TOTAL_LABEL}. The ordered fields are {fieldList(ADAPTER_SUPPORT_FIELDS)}.
      </div>
      <div className="px-4">
        {ADAPTER_SUPPORT_ENTRIES.map((entry) => (
          <AdapterSupportRow entry={entry} key={entry.id} />
        ))}
      </div>
    </section>
  );
}

function CapabilityRow({ entry }: { entry: AdapterSupportEntry }) {
  return (
    <div className="border-fd-border border-t py-4 first:border-t-0">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="md:w-64 md:shrink-0">
          <a className="font-medium text-fd-foreground underline-offset-4 hover:underline" href={entry.setupHref}>
            {entry.label}
          </a>
        </div>
        <dl className="grid min-w-0 flex-1 gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
          {(Object.keys(CAPABILITY_LABELS) as (keyof AdapterSupportCapabilities)[]).map((key) => (
            <div className="flex justify-between gap-3" key={key}>
              <dt className="text-fd-muted-foreground">{CAPABILITY_LABELS[key]}</dt>
              <dd className="font-medium text-fd-foreground">{capabilityValue(entry.capabilities, key)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

export function AdapterCapabilitySupport() {
  return (
    <section className="my-6 rounded-xl border border-fd-border bg-fd-card/40">
      <div className="border-fd-border border-b px-4 py-3 text-sm text-fd-muted-foreground">
        Delivery behavior by built-in adapter. Unsupported message fields still fail field validation first.
      </div>
      <div className="px-4">
        {ADAPTER_SUPPORT_ENTRIES.map((entry) => (
          <CapabilityRow entry={entry} key={entry.id} />
        ))}
      </div>
    </section>
  );
}
