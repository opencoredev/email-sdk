import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { ThemeToggle } from "@/components/theme-toggle";
import { VersionPicker } from "@/components/version-picker";

import { appName, gitConfig } from "./shared";

type BaseOptionsConfig = {
  mainLinks?: boolean;
  versionPicker?: boolean;
};

export function baseOptions({
  mainLinks = true,
  versionPicker = true,
}: BaseOptionsConfig = {}): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-3">
          <EmailSdkLogoIcon />
          <span>{appName}</span>
        </span>
      ),
    },
    themeSwitch: {
      component: <ThemeToggle />,
    },
    links: [
      ...(mainLinks
        ? [
            {
              type: "main" as const,
              text: "Docs",
              url: "/docs",
              active: "nested-url" as const,
            },
            {
              type: "main" as const,
              text: "Blog",
              url: "/blog",
              active: "nested-url" as const,
            },
            {
              type: "main" as const,
              text: "Compare",
              url: "/compare",
              active: "nested-url" as const,
            },
            {
              type: "main" as const,
              text: "Tools",
              url: "/tools",
              active: "nested-url" as const,
            },
          ]
        : []),
      ...(versionPicker
        ? [
            {
              type: "custom" as const,
              secondary: true,
              children: <VersionPicker />,
            },
          ]
        : []),
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}

function EmailSdkLogoIcon() {
  return (
    <img alt="" aria-hidden="true" className="size-8 shrink-0 object-contain" src="/logo.png" />
  );
}
