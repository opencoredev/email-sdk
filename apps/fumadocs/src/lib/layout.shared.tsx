import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import logoUrl from "../../../../logo.svg?url";
import { appName, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2">
          <img alt="" aria-hidden="true" className="size-4 shrink-0" src={logoUrl} />
          <span>{appName}</span>
        </span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
