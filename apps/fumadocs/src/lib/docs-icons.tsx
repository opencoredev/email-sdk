import {
  AlertCircleIcon,
  ArtificialIntelligence02Icon,
  BlocksIcon,
  BookOpen01Icon,
  Database01Icon,
  GitCompareArrowsIcon,
  LibraryIcon,
  MailAtSign01Icon,
  PackageAddIcon,
  PlugSocketIcon,
  ReplaceAllIcon,
  Rocket01Icon,
  ServerStack01Icon,
  TerminalIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

import { providers } from "./providers";

type IconData = ComponentProps<typeof HugeiconsIcon>["icon"];

const docsIcons = {
  Blocks: BlocksIcon,
  BookOpen: BookOpen01Icon,
  Bot: ArtificialIntelligence02Icon,
  CircleAlert: AlertCircleIcon,
  Database: Database01Icon,
  GitCompare: GitCompareArrowsIcon,
  LibraryBig: LibraryIcon,
  MailAtSign: MailAtSign01Icon,
  PackagePlus: PackageAddIcon,
  Plug: PlugSocketIcon,
  Replace: ReplaceAllIcon,
  Rocket: Rocket01Icon,
  Terminal: TerminalIcon,
  Wrench: Wrench01Icon,
} satisfies Record<string, IconData>;

export function resolveDocsIcon(icon: string | undefined) {
  if (!icon) {
    return undefined;
  }

  const provider = providers.find((item) => item.key === icon);

  if (provider) {
    if (!provider.logo) {
      return <DocsIcon icon={ServerStack01Icon} />;
    }

    return (
      <ProviderSidebarIcon
        invertOnDark={"invertOnDark" in provider && provider.invertOnDark}
        logo={provider.logo}
        name={provider.name}
      />
    );
  }

  const iconData = docsIcons[icon as keyof typeof docsIcons];

  if (!iconData) {
    console.warn(`[docs-icons] Unknown icon detected: ${icon}.`);
    return undefined;
  }

  return <DocsIcon icon={iconData} />;
}

function DocsIcon({ icon }: { icon: IconData }) {
  return (
    <HugeiconsIcon
      aria-hidden="true"
      className="size-4 shrink-0 text-fd-muted-foreground"
      icon={icon}
      size={16}
      strokeWidth={1.8}
    />
  );
}

function ProviderSidebarIcon({
  invertOnDark,
  logo,
  name,
}: {
  invertOnDark: boolean;
  logo: string;
  name: string;
}) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`size-5 shrink-0 object-contain ${invertOnDark ? "dark:invert" : ""}`}
      data-provider-icon={name}
      height={20}
      loading="lazy"
      src={logo}
      width={20}
    />
  );
}
