import { RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { currentBuildInfo, isOutdatedBuild, type BuildInfo } from "@/lib/build-info";

const checkIntervalMs = 5 * 60 * 1000;

async function fetchBuildInfo() {
  const response = await fetch(`/api/build-info?t=${Date.now()}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    return undefined;
  }

  return (await response.json()) as Partial<BuildInfo>;
}

export function StaleBuildNotice() {
  const [outdated, setOutdated] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let canceled = false;

    async function checkBuild() {
      try {
        const deployed = await fetchBuildInfo();
        if (canceled) return;

        if (isOutdatedBuild(currentBuildInfo.buildId, deployed?.buildId)) {
          setOutdated(true);
        }
      } catch {
        // Network failures should not interrupt docs reading.
      }
    }

    const checkVisibleBuild = () => {
      if (document.visibilityState === "visible") {
        void checkBuild();
      }
    };

    void checkBuild();
    const interval = window.setInterval(checkBuild, checkIntervalMs);

    window.addEventListener("focus", checkBuild);
    document.addEventListener("visibilitychange", checkVisibleBuild);

    return () => {
      canceled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkBuild);
      document.removeEventListener("visibilitychange", checkVisibleBuild);
    };
  }, []);

  if (!outdated || dismissed) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-start gap-3 rounded-lg border border-fd-border bg-fd-card p-3 text-sm text-fd-foreground shadow-xl md:bottom-5"
      role="status"
    >
      <div className="grid size-8 shrink-0 place-items-center rounded-md border border-fd-border bg-fd-muted text-fd-muted-foreground">
        <RefreshCw className="size-4" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-5">A newer docs build is available.</p>
        <p className="mt-0.5 text-xs leading-5 text-fd-muted-foreground">
          Refresh this tab to clear stale cached navigation and load the latest pages.
        </p>
        <button
          className="mt-2 inline-flex h-8 items-center justify-center rounded-md bg-fd-primary px-3 text-xs font-medium text-fd-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
          onClick={() => window.location.reload()}
          type="button"
        >
          Refresh docs
        </button>
      </div>
      <button
        aria-label="Dismiss update notice"
        className="grid size-7 shrink-0 place-items-center rounded-md text-fd-muted-foreground transition hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
        onClick={() => setDismissed(true)}
        type="button"
      >
        <X className="size-4" strokeWidth={2} />
      </button>
    </div>
  );
}
