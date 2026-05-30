import { Link } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { useSelectedDocsVersion } from "@/lib/docs-version-state";
import { getDocsVersionHref } from "@/lib/versions";

type DocsVersionLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  children: ReactNode;
  docsPath?: string;
  preload?: "intent" | false;
};

export function DocsVersionLink({
  children,
  docsPath = "/docs",
  preload = "intent",
  ...props
}: DocsVersionLinkProps) {
  const selectedVersion = useSelectedDocsVersion();
  const href = getDocsVersionHref(selectedVersion, docsPath);
  const splat = href.replace(/^\/docs\/?/, "");

  return (
    <Link to="/docs/$" params={{ _splat: splat }} preload={preload} {...props}>
      {children}
    </Link>
  );
}
