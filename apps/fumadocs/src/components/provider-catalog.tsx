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
            <div>
              <div className="font-medium">{provider.name}</div>
              <div className="text-xs text-fd-muted-foreground">{provider.category}</div>
            </div>
          </div>
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
    <div className="not-prose mb-6 flex w-fit items-center gap-3 rounded-lg border border-fd-border bg-fd-card px-3 py-2 text-sm text-fd-foreground">
      <ProviderMark logo={provider.logo} name={provider.name} />
      <div>
        <div className="font-medium">{provider.name}</div>
        <code className="text-xs text-fd-muted-foreground">{provider.importPath}</code>
      </div>
    </div>
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
