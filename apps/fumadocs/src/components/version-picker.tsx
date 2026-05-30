import { Check, ChevronDown, ExternalLink, PackageCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { docsVersion, docsVersions, sdkPackageName, versionLinks } from "@/lib/versions";

export function VersionPicker() {
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!detailsRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <details
      className="group/version relative block"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
      open={open}
      ref={detailsRef}
    >
      <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-fd-border bg-fd-background px-3 text-sm font-medium text-fd-foreground transition hover:bg-fd-accent [&::-webkit-details-marker]:hidden">
        <PackageCheck className="size-4 text-fd-muted-foreground" strokeWidth={2} />
        <span>{docsVersion}</span>
        <ChevronDown
          className="size-3.5 text-fd-muted-foreground transition group-open/version:rotate-180"
          strokeWidth={2}
        />
      </summary>

      <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-lg border border-fd-border bg-fd-popover text-fd-popover-foreground shadow-xl shadow-black/10">
        <div className="border-b border-fd-border px-3 py-2">
          <p className="text-xs font-medium uppercase text-fd-muted-foreground">Docs version</p>
          <p className="mt-0.5 truncate text-sm">{sdkPackageName}</p>
        </div>

        <div className="p-1.5">
          {docsVersions.map((version) => (
            <a
              className="flex items-start gap-2 rounded-md px-2 py-2 text-sm transition hover:bg-fd-accent"
              href={version.href}
              key={version.label}
              onClick={() => {
                setOpen(false);
              }}
            >
              <span className="mt-0.5 grid size-4 place-items-center text-fd-primary">
                {version.current ? <Check className="size-3.5" strokeWidth={2.2} /> : null}
              </span>
              <span>
                <span className="block font-medium">{version.label}</span>
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
      </div>
    </details>
  );
}
