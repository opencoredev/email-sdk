import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { appName, gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2.5">
          <span className="grid size-6 place-items-center rounded-md border border-fd-border bg-fd-card">
            <EmailSdkLogoIcon />
          </span>
          <span>{appName}</span>
        </span>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}

function EmailSdkLogoIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.5 text-fd-primary"
      fill="none"
      viewBox="0 0 1024 1024"
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="52">
        <rect height="292" rx="62" width="366" x="126" y="326" />
        <path d="M164 376L309 500L454 376" />
        <path d="M492 472H604" />
        <path d="M604 472C648 372 714 324 792 312" />
        <path d="M604 472H792" />
        <path d="M604 472C648 572 714 620 792 632" />
        <rect height="122" rx="30" width="122" x="792" y="250" />
        <rect height="122" rx="30" width="122" x="792" y="410" />
        <rect height="122" rx="30" width="122" x="792" y="570" />
      </g>
    </svg>
  );
}
