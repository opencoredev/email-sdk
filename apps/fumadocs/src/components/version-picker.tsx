import { Check, ChevronDown, ExternalLink, PackageCheck } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "fumadocs-ui/components/ui/popover";
import { usePathname } from "fumadocs-core/framework";

import { rememberDocsVersion, useSelectedDocsVersion } from "@/lib/docs-version-state";
import { docsVersions, getDocsVersionHref, getVersionLinks, sdkPackageName } from "@/lib/versions";

type VersionPickerProps = {
  variant?: "nav" | "sidebar";
};

export function VersionPicker({ variant = "nav" }: VersionPickerProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const currentVersion = useSelectedDocsVersion();
  const isSidebar = variant === "sidebar";
  const versionLinks = getVersionLinks(currentVersion);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        className={`group/version inline-flex h-9 items-center gap-2 rounded-md border border-fd-border px-3 text-sm font-medium text-fd-foreground transition hover:bg-fd-accent data-[state=open]:bg-fd-accent data-[state=open]:text-fd-accent-foreground ${
          isSidebar ? "w-full justify-start bg-fd-secondary/50" : "bg-fd-background"
        }`}
      >
        <PackageCheck className="size-4 text-fd-muted-foreground" strokeWidth={2} />
        <span className="leading-none">{currentVersion.label}</span>
        {currentVersion.label !== currentVersion.version ? (
          <span className="rounded-sm bg-fd-muted px-1.5 py-0.5 text-[11px] leading-none text-fd-muted-foreground">
            {currentVersion.version}
          </span>
        ) : null}
        <ChevronDown
          className={`size-3.5 text-fd-muted-foreground transition group-data-[state=open]/version:rotate-180 ${
            isSidebar ? "ms-auto" : ""
          }`}
          strokeWidth={2}
        />
      </PopoverTrigger>

      <PopoverContent align={isSidebar ? "start" : "end"} className="w-80 p-0">
        <div className="border-b border-fd-border px-3 py-2.5">
          <p className="text-xs font-medium uppercase text-fd-muted-foreground">Docs version</p>
          <p className="mt-0.5 truncate text-sm">{sdkPackageName}</p>
        </div>

        <div className="max-h-64 overflow-y-auto p-1.5 fd-scroll-container">
          {docsVersions.map((version) => (
            <a
              className="flex items-start gap-2 rounded-md px-2 py-2 text-sm transition hover:bg-fd-accent hover:text-fd-accent-foreground"
              href={getDocsVersionHref(version, pathname)}
              key={version.label}
              onClick={() => {
                rememberDocsVersion(version);
                setOpen(false);
              }}
            >
              <span className="mt-0.5 grid size-4 place-items-center text-fd-primary">
                {version === currentVersion ? (
                  <Check className="size-3.5" strokeWidth={2.2} />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-medium">
                  {version.label}
                  {version.label !== version.version ? (
                    <span className="text-xs font-normal text-fd-muted-foreground">
                      {version.version}
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs text-fd-muted-foreground">
                  {version.description}
                </span>
              </span>
            </a>
          ))}
        </div>

        <div className="border-t border-fd-border p-1.5">
          {versionLinks.map((link) => (
            <a
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs text-fd-muted-foreground transition hover:bg-fd-accent hover:text-fd-foreground"
              href={link.href}
              key={link.href}
              onClick={() => {
                setOpen(false);
              }}
              rel="noreferrer"
              target="_blank"
            >
              {link.label}
              <ExternalLink className="size-3" strokeWidth={2} />
            </a>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
