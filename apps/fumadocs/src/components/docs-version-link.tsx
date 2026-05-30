import type { AnchorHTMLAttributes, ReactNode } from "react";

import { useSelectedDocsVersion } from "@/lib/docs-version-state";
import { getDocsVersionHref } from "@/lib/versions";

type DocsVersionLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  children: ReactNode;
  docsPath?: string;
};

export function DocsVersionLink({ children, docsPath = "/docs", ...props }: DocsVersionLinkProps) {
  const selectedVersion = useSelectedDocsVersion();

  return (
    <a {...props} href={getDocsVersionHref(selectedVersion, docsPath)}>
      {children}
    </a>
  );
}
