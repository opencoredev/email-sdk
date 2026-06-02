import { ExternalLink } from "lucide-react";

import { DocsVersionLink } from "@/components/docs-version-link";
import { providers } from "@/lib/providers";

export function ProviderGrid() {
  return (
    <div className="not-prose grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {providers.map((provider) => (
        <article
          className="rounded-lg border border-fd-border bg-fd-card p-4 text-fd-foreground transition hover:bg-fd-accent/40"
          key={provider.key}
        >
          <div className="flex items-center gap-3">
            <ProviderMark logo={provider.logo} name={provider.name} />
            <div>
              <div className="font-medium">{provider.name}</div>
              <div className="text-xs text-fd-muted-foreground">{provider.category}</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <ProviderPill>{provider.status}</ProviderPill>
            {"sponsorship" in provider ? <ProviderPill>{provider.sponsorship}</ProviderPill> : null}
            <ProviderPill>{provider.testStatus}</ProviderPill>
            <ProviderPill muted>{provider.liveStatus}</ProviderPill>
          </div>
          <code className="mt-3 block text-xs text-fd-muted-foreground">{provider.importPath}</code>
          <div className="mt-4 flex items-center gap-2">
            <DocsVersionLink
              className="inline-flex h-8 items-center justify-center rounded-md border border-fd-border px-3 text-xs font-medium transition hover:bg-fd-accent"
              docsPath={provider.docs}
              forceLatest={"currentOnly" in provider && provider.currentOnly}
            >
              Docs
            </DocsVersionLink>
            <a
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-fd-border px-3 text-xs font-medium transition hover:bg-fd-accent"
              href={provider.website}
              rel="noreferrer"
              target="_blank"
            >
              Website
              <ExternalLink aria-hidden="true" className="size-3" strokeWidth={2} />
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}

export function ProviderBadge({ adapter }: { adapter: string }) {
  const provider = providers.find((item) => item.key === adapter);

  if (!provider) {
    return null;
  }

  return (
    <div className="not-prose mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-fd-border bg-fd-card px-3 py-2 text-sm text-fd-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <ProviderMark logo={provider.logo} name={provider.name} />
        <div className="min-w-0">
          <div className="font-medium">{provider.name}</div>
          <code className="break-all text-xs text-fd-muted-foreground">{provider.importPath}</code>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ProviderPill>{provider.status}</ProviderPill>
            {"sponsorship" in provider ? <ProviderPill>{provider.sponsorship}</ProviderPill> : null}
            <ProviderPill>{provider.testStatus}</ProviderPill>
            <ProviderPill muted>{provider.liveStatus}</ProviderPill>
          </div>
        </div>
      </div>
      <a
        className="ml-auto inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-fd-border px-3 text-xs font-medium transition hover:bg-fd-accent"
        href={provider.website}
        rel="noreferrer"
        target="_blank"
      >
        Open website
        <ExternalLink aria-hidden="true" className="size-3" strokeWidth={2} />
      </a>
    </div>
  );
}

function ProviderPill({ children, muted = false }: { children: string; muted?: boolean }) {
  return (
    <span
      className={`rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-none ${
        muted
          ? "border-fd-border bg-fd-muted text-fd-muted-foreground"
          : "border-fd-primary/20 bg-fd-primary/10 text-fd-primary"
      }`}
    >
      {children}
    </span>
  );
}

function ProviderMark({ logo, name }: { logo: string; name: string }) {
  if (!logo) {
    return (
      <span className="grid size-9 place-items-center rounded-md border border-fd-border bg-fd-muted text-xs font-medium">
        SMTP
      </span>
    );
  }

  return (
    <span className="grid size-9 place-items-center rounded-md border border-fd-border bg-white p-1.5">
      <img
        alt={`${name} logo`}
        className="size-full object-contain"
        height={24}
        src={logo}
        width={24}
      />
    </span>
  );
}
