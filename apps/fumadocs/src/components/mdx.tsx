import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { File, Files, Folder } from "fumadocs-ui/components/files";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { TypeTable } from "fumadocs-ui/components/type-table";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { AdapterCapabilitySupport, AdapterFieldSupport } from "./adapter-support";
import { CommunityPluginRegistry } from "./community-plugin-registry";
import { EmailExample, EmailExampleGallery } from "./email-examples";
import { PackageInstallTabs } from "./package-install-tabs";
import { ProviderBadge, ProviderGrid } from "./provider-catalog";
import { SponsorSpotlight } from "./sponsors";

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
        className={["docs-card", props.className].filter(Boolean).join(" ")}
        href={versionDocsHref(props.href, docsBasePath) as string}
      />
    ),
    Accordion,
    Accordions,
    AdapterCapabilitySupport,
    AdapterFieldSupport,
    CommunityPluginRegistry,
    EmailExample,
    EmailExampleGallery,
    File,
    Files,
    Folder,
    PackageInstallTabs,
    ProviderBadge,
    ProviderGrid,
    SponsorSpotlight,
    Step,
    Steps,
    Tab,
    Tabs,
    TypeTable,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
