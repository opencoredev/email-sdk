import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { CommunityPluginRegistry } from "./community-plugin-registry";
import { ProviderBadge, ProviderGrid } from "./provider-catalog";

type MdxComponentOptions = {
  docsBasePath?: string;
};

function versionDocsHref(href: unknown, docsBasePath: string) {
  if (typeof href !== "string" || docsBasePath === "/docs") return href;
  if (href === "/docs") return docsBasePath;
  if (href.startsWith("/docs/")) return `${docsBasePath}${href.slice("/docs".length)}`;

  return href;
}

export function getMDXComponents(components?: MDXComponents, options: MdxComponentOptions = {}) {
  const docsBasePath = options.docsBasePath ?? "/docs";

  return {
    ...defaultMdxComponents,
    a: (props) => (
      <defaultMdxComponents.a
        {...props}
        href={versionDocsHref(props.href, docsBasePath) as string}
      />
    ),
    Card: (props) => (
      <defaultMdxComponents.Card
        {...props}
        href={versionDocsHref(props.href, docsBasePath) as string}
      />
    ),
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
