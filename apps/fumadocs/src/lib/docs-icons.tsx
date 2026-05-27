import { icons } from "lucide-react";
import { createElement } from "react";

import { providers } from "./providers";

export function resolveDocsIcon(icon: string | undefined) {
  if (!icon) {
    return undefined;
  }

  const provider = providers.find((item) => item.key === icon);

  if (provider) {
    if (!provider.logo) {
      return createElement(TransportSidebarIcon);
    }

    return createElement(ProviderSidebarIcon, {
      logo: "sidebarLogo" in provider ? provider.sidebarLogo : provider.logo,
      name: provider.name,
    });
  }

  const Icon = icons[icon as keyof typeof icons];

  if (!Icon) {
    console.warn(`[docs-icons] Unknown icon detected: ${icon}.`);
    return undefined;
  }

  return createElement(Icon);
}

function ProviderSidebarIcon({ logo, name }: { logo: string; name: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="size-4 shrink-0 object-contain opacity-85"
      data-provider-icon={name}
      height={16}
      loading="lazy"
      src={logo}
      width={16}
    />
  );
}

function TransportSidebarIcon() {
  return createElement(icons.Server, {
    className: "size-4 shrink-0 text-fd-muted-foreground",
    strokeWidth: 2,
  });
}
