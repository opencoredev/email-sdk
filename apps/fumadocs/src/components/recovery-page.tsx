import { Link, type ErrorComponentProps, type NotFoundRouteProps } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import {
  ArrowRight,
  BookOpen,
  ExternalLink,
  FileQuestion,
  Home,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";

import { baseOptions } from "@/lib/layout.shared";

type RecoveryKind = "chunk" | "dom" | "not-found" | "runtime";

type RecoveryCopy = {
  eyebrow: string;
  title: string;
  description: string;
  note: string;
};

const helpLinks = [
  {
    icon: BookOpen,
    label: "Start with the docs",
    description: "Open the current documentation index.",
    href: "/docs",
  },
  {
    icon: Search,
    label: "Install guide",
    description: "Get the package and CLI commands again.",
    href: "/docs/getting-started/install",
  },
  {
    icon: ShieldCheck,
    label: "Fallbacks and retries",
    description: "Review the production delivery path.",
    href: "/docs/concepts/fallbacks-and-retries",
  },
] as const;

export function NotFoundPage(_props?: NotFoundRouteProps) {
  return (
    <RecoveryLayout
      copy={getRecoveryCopy("not-found")}
      details="The requested route was not found in the docs site."
      icon={<FileQuestion className="size-5" />}
      status="404"
    />
  );
}

export function AppErrorPage({ error, reset }: ErrorComponentProps) {
  const kind = classifyRecoveryError(error);
  const copy = getRecoveryCopy(kind);

  return (
    <RecoveryLayout
      copy={copy}
      details={getErrorMessage(error)}
      icon={<TriangleAlert className="size-5" />}
      onRetry={reset}
      status={kind === "chunk" ? "Reload needed" : "Runtime error"}
    />
  );
}

export function classifyRecoveryError(error: unknown): RecoveryKind {
  const message = getErrorMessage(error);

  if (
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed/i.test(
      message,
    )
  ) {
    return "chunk";
  }

  if (
    /removeChild|insertBefore|The node to be removed is not a child|The node before which the new node is to be inserted is not a child/i.test(
      message,
    )
  ) {
    return "dom";
  }

  return "runtime";
}

export function getErrorMessage(error: unknown) {
  if (!error) return "No error details were provided.";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Unknown error");
  }

  return String(error);
}

function getRecoveryCopy(kind: RecoveryKind): RecoveryCopy {
  if (kind === "chunk") {
    return {
      eyebrow: "Asset refreshed",
      title: "This docs page needs a clean reload.",
      description:
        "Your browser tried to open an older JavaScript chunk from a previous deploy. Refreshing brings the page onto the current release.",
      note: "The site now detects stale chunks and reloads once automatically.",
    };
  }

  if (kind === "dom") {
    return {
      eyebrow: "Page recovered",
      title: "The docs hit a browser DOM conflict.",
      description:
        "Browser translation tools and extensions can sometimes edit the page while React is rendering. Refreshing restores the docs without losing the route.",
      note: "The site now guards the React DOM operations that caused this class of crash.",
    };
  }

  if (kind === "not-found") {
    return {
      eyebrow: "Page not found",
      title: "That docs route is not here.",
      description:
        "The page may have moved, the version path may be stale, or the URL may have a typo.",
      note: "The current docs index is the safest place to continue.",
    };
  }

  return {
    eyebrow: "Docs interrupted",
    title: "The docs could not finish loading.",
    description:
      "This is an application error state, but you still have a stable way back into the documentation.",
    note: "Retry first. If it keeps happening, open the docs index or report the exact URL.",
  };
}

function RecoveryLayout({
  copy,
  details,
  icon,
  onRetry,
  status,
}: {
  copy: RecoveryCopy;
  details: string;
  icon: ReactNode;
  onRetry?: () => void;
  status: string;
}) {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="min-h-[calc(100vh-4rem)] border-b border-fd-border bg-fd-background text-fd-foreground">
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-14 md:px-10 md:py-20">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-md border border-fd-border bg-fd-muted px-2.5 py-1 text-xs font-medium text-fd-muted-foreground">
              {icon}
              <span>{status}</span>
            </div>
            <p className="mt-8 text-sm font-medium text-fd-primary">{copy.eyebrow}</p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight tracking-normal md:text-6xl">
              {copy.title}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-fd-muted-foreground md:text-lg md:leading-8">
              {copy.description}
            </p>
          </div>

          <div className="grid gap-4 border-y border-fd-border py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <p className="max-w-2xl text-sm leading-6 text-fd-muted-foreground">{copy.note}</p>
            <div className="flex flex-wrap gap-2">
              {onRetry ? (
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-fd-primary px-3 py-2 text-sm font-medium text-fd-primary-foreground transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
                  onClick={onRetry}
                  type="button"
                >
                  <RefreshCw className="size-4" />
                  Retry
                </button>
              ) : null}
              <button
                className="inline-flex items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card px-3 py-2 text-sm font-medium text-fd-foreground transition hover:bg-fd-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
                onClick={() => window.location.reload()}
                type="button"
              >
                <RefreshCw className="size-4" />
                Refresh
              </button>
              <Link
                className="inline-flex items-center justify-center gap-2 rounded-md border border-fd-border bg-fd-card px-3 py-2 text-sm font-medium text-fd-foreground transition hover:bg-fd-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
                to="/"
              >
                <Home className="size-4" />
                Home
              </Link>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {helpLinks.map((item) => (
              <a
                className="group rounded-lg border border-fd-border bg-fd-card p-4 transition hover:border-fd-primary/50 hover:bg-fd-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary"
                href={item.href}
                key={item.href}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <item.icon className="size-4 text-fd-primary" />
                  <span>{item.label}</span>
                  <ArrowRight className="ml-auto size-4 text-fd-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-fd-foreground" />
                </div>
                <p className="mt-2 text-sm leading-6 text-fd-muted-foreground">
                  {item.description}
                </p>
              </a>
            ))}
          </div>

          <details className="rounded-lg border border-fd-border bg-fd-card p-4 text-sm text-fd-muted-foreground">
            <summary className="cursor-pointer font-medium text-fd-foreground">
              Technical details
            </summary>
            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-fd-muted p-3 text-xs leading-5">
              {details}
            </pre>
          </details>

          <a
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-fd-muted-foreground transition hover:text-fd-foreground"
            href="https://github.com/opencoredev/email-sdk/issues"
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-4" />
            Report a docs issue
          </a>
        </section>
      </main>
    </HomeLayout>
  );
}
