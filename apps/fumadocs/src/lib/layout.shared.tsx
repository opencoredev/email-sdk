import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { VersionPicker } from "@/components/version-picker";

import { appName, gitConfig } from "./shared";

type BaseOptionsConfig = {
  versionPicker?: boolean;
};

export function baseOptions({ versionPicker = true }: BaseOptionsConfig = {}): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-3">
          <EmailSdkLogoIcon />
          <span>{appName}</span>
        </span>
      ),
    },
    links: [
      {
        type: "main",
        text: "Docs",
        url: "/docs",
        active: "nested-url",
      },
      {
        type: "main",
        text: "Blog",
        url: "/blog",
        active: "nested-url",
      },
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
    <img
      alt=""
      aria-hidden="true"
      className="size-8 shrink-0 object-contain"
      src="/logo.png"
    />
  );
}
