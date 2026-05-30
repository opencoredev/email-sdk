import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { CommunityPluginRegistry } from "./community-plugin-registry";
import { ProviderBadge, ProviderGrid } from "./provider-catalog";

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    CommunityPluginRegistry,
    ProviderBadge,
    ProviderGrid,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
