import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Mail } from "lucide-react";

import { appName, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // JSX supported
      title: (
        <span className="flex items-center gap-2.5">
          <span className="grid size-6 place-items-center rounded-md border border-fd-border bg-fd-card">
            <Mail className="size-3.5 text-fd-primary" strokeWidth={2} />
          </span>
          <span>{appName}</span>
        </span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
