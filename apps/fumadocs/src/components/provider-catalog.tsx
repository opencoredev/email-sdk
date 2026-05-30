import { Link } from "@tanstack/react-router";

import { providers } from "@/lib/providers";

export function ProviderGrid() {
  return (
    <div className="not-prose grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {providers.map((provider) => (
        <Link
          className="rounded-lg border border-fd-border bg-fd-card p-4 text-fd-foreground transition hover:bg-fd-accent/60"
          key={provider.key}
          params={{ _splat: provider.docs.replace("/docs/", "") }}
          preload="intent"
          to="/docs/$"
        >
          <div className="flex items-center gap-3">
            <ProviderMark logo={provider.logo} name={provider.name} />
            <div className="min-w-0">
              <div className="font-medium">{provider.name}</div>
              <div className="text-xs text-fd-muted-foreground">{provider.category}</div>
            </div>
          </div>
          <VerificationPill status={provider.verification.status} />
          <code className="mt-3 block text-xs text-fd-muted-foreground">{provider.importPath}</code>
        </Link>
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
    <div className="not-prose mb-6 max-w-2xl rounded-lg border border-fd-border bg-fd-card px-3 py-3 text-sm text-fd-foreground">
      <div className="flex items-center gap-3">
        <ProviderMark logo={provider.logo} name={provider.name} />
        <div className="min-w-0">
          <div className="font-medium">{provider.name}</div>
          <code className="text-xs text-fd-muted-foreground">{provider.importPath}</code>
        </div>
        <VerificationPill className="ml-auto" status={provider.verification.status} />
      </div>
      <div className="mt-3 border-t border-fd-border pt-3 text-xs leading-5 text-fd-muted-foreground">
        {provider.verification.note} If live delivery fails or provider behavior has changed,{" "}
        <a className="font-medium text-fd-foreground underline" href="https://github.com/t3dotgg/email-sdk/issues">
          open an issue
        </a>
        .
      </div>
    </div>
  );
}

function VerificationPill({
  className,
  status,
}: {
  className?: string;
  status: "verified" | "untested";
}) {
  if (status === "verified") {
    return (
      <span
        className={`mt-3 inline-flex w-fit rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 ${className ?? ""}`}
      >
        Live verified
      </span>
    );
  }

  return (
    <span
      className={`mt-3 inline-flex w-fit rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300 ${className ?? ""}`}
    >
      Untested live
    </span>
  );
}

function ProviderMark({ logo, name }: { logo: string; name: string }) {
  if (!logo) {
    return (
      <span className="grid size-9 shrink-0 place-items-center rounded-md border border-fd-border bg-fd-muted text-xs font-medium">
        SMTP
      </span>
    );
  }

  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-md border border-fd-border bg-white p-1.5">
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
