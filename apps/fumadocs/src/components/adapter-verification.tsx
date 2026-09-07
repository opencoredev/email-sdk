import {
  EVIDENCE_KINDS,
  evidenceState,
  verificationRows,
  type EvidenceKind,
  type EvidenceRecord,
} from "../lib/adapter-verification";

const COLUMNS: Record<EvidenceKind, string> = {
  "contract-test": "Contract tests",
  "auth-probe-configured": "Configured auth probe",
  "auth-check": "Dated auth check",
  "send-verified": "Verified send",
  "delivery-verified": "Verified delivery",
};

export function AdapterVerification({ evidence, now }: { evidence?: unknown; now?: Date }) {
  const rows = verificationRows(evidence, now);
  const configured = rows.filter((row) => row.check).length;
  const published = rows.reduce(
    (count, row) => count + Object.values(row.evidence).filter(Boolean).length,
    0,
  );
  return (
    <div className="not-prose my-6 min-w-0 space-y-4">
      <p className="text-sm text-fd-muted-foreground">
        {rows.length} adapters · {configured} configured auth probes · {published} published run
        records. A configured test or probe is configuration, not a passing result. Published records
        older than 30 days are marked stale.
      </p>
      <div
        aria-label="Adapter verification evidence"
        className="max-w-full overflow-x-auto rounded-lg border border-fd-border"
        role="region"
        tabIndex={0}
      >
        <table className="w-full min-w-[1040px] text-left text-sm">
          <caption className="sr-only">
            Configured checks and published run evidence per adapter, separately scoped to contract
            tests, configured authentication probe, dated authentication check, verified send, and
            verified delivery.
          </caption>
          <thead className="bg-fd-muted/50">
            <tr>
              <th scope="col" className="p-3 font-medium">
                Adapter
              </th>
              {EVIDENCE_KINDS.map((kind) => (
                <th key={kind} scope="col" className="p-3 font-medium">
                  {COLUMNS[kind]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-fd-border">
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <th scope="row" className="p-3 font-medium">
                  <a href={row.setupHref} className="underline underline-offset-4">
                    {row.label}
                  </a>
                </th>
                {EVIDENCE_KINDS.map((kind) => (
                  <td key={kind} className="max-w-64 space-y-2 p-3">
                    {kind === "contract-test" ? (
                      <ContractTests files={row.contractTestFiles} />
                    ) : null}
                    {kind === "auth-probe-configured" ? (
                      <>
                        <p>{row.check ? "Live check available" : "No live check configured"}</p>
                        {row.check ? (
                          <p className="text-xs text-fd-muted-foreground">
                            Configured probe, not a published passing run. {row.check.probe}
                          </p>
                        ) : null}
                      </>
                    ) : null}
                    <RunEvidence record={row.evidence[kind]} now={now} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContractTests({ files }: { files: readonly string[] }) {
  if (files.length === 0) return <p>No contract tests found</p>;
  return (
    <>
      <p>Contract tests exist</p>
      <p className="text-xs text-fd-muted-foreground">
        {files.map((file) => (
          <code key={file} className="mr-1">
            {file}
          </code>
        ))}
      </p>
    </>
  );
}

function RunEvidence({ record, now }: { record?: EvidenceRecord; now?: Date }) {
  const isCi = record?.source.startsWith("https://");
  return (
    <div className="space-y-1 text-xs text-fd-muted-foreground">
      <p className={record?.outcome === "fail" ? "font-medium text-fd-foreground" : undefined}>
        {evidenceState(record, now)}
      </p>
      {record ? (
        <>
          <p>
            <time dateTime={record.timestamp}>
              {record.timestamp.replace("T", " ").replace("Z", " UTC")}
            </time>
          </p>
          <p>Scope: {record.scope}</p>
          <p>{record.summary}</p>
          {isCi ? (
            <a
              href={record.source}
              className="underline underline-offset-4"
              target="_blank"
              rel="noreferrer"
            >
              Source run · {record.sourceCommit.slice(0, 7)}
            </a>
          ) : (
            <p>
              Source: {record.source} · {record.sourceCommit.slice(0, 7)}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
