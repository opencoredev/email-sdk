import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import { baseOptions } from "@/lib/layout.shared";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <p className="mb-3 text-sm text-fd-muted-foreground">
          Unified email sending for TypeScript.
        </p>
        <h1 className="mb-4 text-3xl font-medium text-fd-foreground">Email SDK</h1>
        <p className="mb-6 max-w-lg text-fd-muted-foreground">
          One small API for Resend, SMTP, Postmark, fallbacks, retries, and test sends.
        </p>
        <Link
          to="/docs/$"
          params={{
            _splat: "",
          }}
          className="mx-auto rounded-lg bg-fd-primary px-3 py-2 text-sm font-medium text-fd-primary-foreground"
        >
          Open docs
        </Link>
      </div>
    </HomeLayout>
  );
}
