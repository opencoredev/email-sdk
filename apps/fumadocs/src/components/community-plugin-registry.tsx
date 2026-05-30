import { ExternalLink, PackageCheck, ShieldCheck, ShieldQuestion } from "lucide-react";

import communityPlugins from "../../content/community/plugins.json";

type CommunityEntry = {
  name: string;
  package: string;
  kind: "adapter" | "plugin" | "hybrid";
  status: "community" | "verified" | "official";
  description: string;
  href: string;
  repo: string;
  maintainer: string;
  pluginId?: string;
  adapter?: string;
  verifiedVersion?: string;
  verification?: {
    reviewedAt: string;
    reviewedBy: string;
    provenance: boolean;
    noInstallScripts: boolean;
    runtimeDependencies: number;
    notes?: string;
  };
};

const entries = communityPlugins as CommunityEntry[];

export function CommunityPluginRegistry() {
  if (entries.length === 0) {
    return (
      <div className="not-prose rounded-lg border border-dashed border-fd-border bg-fd-card/60 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md border border-fd-border bg-fd-muted text-fd-muted-foreground">
            <PackageCheck aria-hidden="true" className="size-4" />
          </span>
          <div>
            <p className="font-medium text-fd-foreground">No community plugins are listed yet.</p>
            <p className="mt-1 text-sm text-fd-muted-foreground">
              Community packages are listed by pull request after their registry entry passes the
              static checks.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="not-prose grid gap-3">
      {entries.map((entry) => (
        <article
          className="rounded-lg border border-fd-border bg-fd-card p-4 transition hover:bg-fd-accent/35"
          key={entry.package}
        >
          <div className="flex flex-wrap items-start gap-3">
            <StatusMark status={entry.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-fd-foreground">{entry.name}</h3>
                <span className="rounded-md border border-fd-border px-1.5 py-0.5 text-[0.6875rem] uppercase tracking-wide text-fd-muted-foreground">
                  {entry.kind}
                </span>
                <span className="rounded-md border border-fd-border px-1.5 py-0.5 text-[0.6875rem] uppercase tracking-wide text-fd-muted-foreground">
                  {entry.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-fd-muted-foreground">{entry.description}</p>
              <code className="mt-3 block break-all text-xs text-fd-muted-foreground">
                {entry.package}
              </code>
              {entry.verification ? (
                <p className="mt-2 text-xs text-fd-muted-foreground">
                  Verified for {entry.verifiedVersion} on {entry.verification.reviewedAt}.
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ExternalButton href={entry.href}>npm</ExternalButton>
            <ExternalButton href={entry.repo}>source</ExternalButton>
          </div>
        </article>
      ))}
    </div>
  );
}

function StatusMark({ status }: { status: CommunityEntry["status"] }) {
  const Icon = status === "community" ? ShieldQuestion : ShieldCheck;

  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-md border border-fd-border bg-fd-muted text-fd-muted-foreground">
      <Icon aria-hidden="true" className="size-4" />
    </span>
  );
}

function ExternalButton({ children, href }: { children: string; href: string }) {
  return (
    <a
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-fd-border px-3 text-xs font-medium text-fd-foreground transition hover:bg-fd-accent"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}
