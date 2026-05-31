"use client";

import { Check, Clipboard } from "lucide-react";
import { useEffect, useState } from "react";

type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

type PackageInstallTabsProps = {
  packageName?: string;
};

type InstallCommand = {
  executable: string;
  verb: string;
  packageName: string;
};

const packageManagerStorageKey = "email-sdk-package-manager";
const packageManagerChangeEvent = "email-sdk-package-manager-change";

const packageManagers: Array<{
  value: PackageManager;
  label: string;
  command: (packageName: string) => InstallCommand;
}> = [
  {
    value: "bun",
    label: "Bun",
    command: (packageName) => ({ executable: "bun", verb: "add", packageName }),
  },
  {
    value: "npm",
    label: "npm",
    command: (packageName) => ({ executable: "npm", verb: "install", packageName }),
  },
  {
    value: "pnpm",
    label: "pnpm",
    command: (packageName) => ({ executable: "pnpm", verb: "add", packageName }),
  },
  {
    value: "yarn",
    label: "Yarn",
    command: (packageName) => ({ executable: "yarn", verb: "add", packageName }),
  },
];

function isPackageManager(value: string | null): value is PackageManager {
  return packageManagers.some((manager) => manager.value === value);
}

export function PackageInstallTabs({
  packageName = "@opencoredev/email-sdk",
}: PackageInstallTabsProps) {
  const [selected, setSelected] = useState<PackageManager>("bun");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function syncStoredManager() {
      const stored = window.localStorage.getItem(packageManagerStorageKey);

      if (isPackageManager(stored)) {
        setSelected(stored);
      }
    }

    syncStoredManager();

    window.addEventListener("storage", syncStoredManager);
    window.addEventListener(packageManagerChangeEvent, syncStoredManager);

    return () => {
      window.removeEventListener("storage", syncStoredManager);
      window.removeEventListener(packageManagerChangeEvent, syncStoredManager);
    };
  }, []);

  function selectManager(value: string) {
    if (!isPackageManager(value)) return;

    setSelected(value);
    window.localStorage.setItem(packageManagerStorageKey, value);
    window.dispatchEvent(new CustomEvent(packageManagerChangeEvent));
  }

  const selectedManager =
    packageManagers.find((manager) => manager.value === selected) ?? packageManagers[0];
  const selectedCommand = selectedManager.command(packageName);
  const commandText = `${selectedCommand.executable} ${selectedCommand.verb} ${selectedCommand.packageName}`;

  async function copyCommand() {
    await navigator.clipboard.writeText(commandText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <figure className="not-prose my-4 overflow-hidden rounded-xl border bg-fd-card text-sm shadow-sm">
      <div className="flex h-10 items-end gap-1 overflow-x-auto border-b px-2">
        {packageManagers.map((manager) => (
          <button
            aria-selected={selected === manager.value}
            className={`relative h-10 px-3 font-medium transition-colors hover:text-fd-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring ${
              selected === manager.value ? "text-fd-primary" : "text-fd-muted-foreground"
            }`}
            key={manager.value}
            onClick={() => selectManager(manager.value)}
            role="tab"
            type="button"
          >
            {manager.label}
            {selected === manager.value ? (
              <span className="absolute inset-x-3 bottom-0 h-px bg-fd-primary" />
            ) : null}
          </button>
        ))}
      </div>
      <div className="relative bg-fd-secondary">
        <pre
          className="overflow-x-auto px-4 py-3.5 pr-12 text-[0.8125rem] leading-6"
          role="tabpanel"
        >
          <code className="whitespace-pre">
            <span className="text-fd-primary">{selectedCommand.executable}</span>{" "}
            <span className="text-fd-foreground">{selectedCommand.verb}</span>{" "}
            <span className="text-fd-accent-foreground">{selectedCommand.packageName}</span>
          </code>
        </pre>
        <button
          aria-label={copied ? "Copied" : "Copy code"}
          className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-lg text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
          onClick={copyCommand}
          type="button"
        >
          {copied ? <Check className="size-4" /> : <Clipboard className="size-4" />}
        </button>
      </div>
    </figure>
  );
}
