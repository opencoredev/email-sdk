import { usePathname } from "fumadocs-core/framework";
import { useEffect, useState } from "react";

import {
  type DocsVersion,
  docsVersionStorageKey,
  getDocsVersionByStoredValue,
  getDocsVersionFromPathname,
  getDocsVersionSlug,
  latestDocsVersion,
} from "./versions";

const docsVersionChangeEvent = "email-sdk-docs-version-change";

function getPathnameVersion(pathname: string) {
  if (!pathname.startsWith("/docs")) return undefined;

  return getDocsVersionFromPathname(pathname);
}

function readStoredDocsVersion() {
  if (typeof window === "undefined") return undefined;

  return getDocsVersionByStoredValue(window.localStorage.getItem(docsVersionStorageKey));
}

export function rememberDocsVersion(version: DocsVersion) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(docsVersionStorageKey, getDocsVersionSlug(version));
  window.dispatchEvent(new CustomEvent(docsVersionChangeEvent));
}

export function useSelectedDocsVersion() {
  const pathname = usePathname();
  const [selectedVersion, setSelectedVersion] = useState(
    () => getPathnameVersion(pathname) ?? latestDocsVersion,
  );

  useEffect(() => {
    const pathnameVersion = getPathnameVersion(pathname);

    if (pathnameVersion) {
      rememberDocsVersion(pathnameVersion);
      setSelectedVersion(pathnameVersion);
      return;
    }

    setSelectedVersion(readStoredDocsVersion() ?? latestDocsVersion);
  }, [pathname]);

  useEffect(() => {
    function syncStoredVersion() {
      setSelectedVersion(readStoredDocsVersion() ?? latestDocsVersion);
    }

    window.addEventListener("storage", syncStoredVersion);
    window.addEventListener(docsVersionChangeEvent, syncStoredVersion);

    return () => {
      window.removeEventListener("storage", syncStoredVersion);
      window.removeEventListener(docsVersionChangeEvent, syncStoredVersion);
    };
  }, []);

  return selectedVersion;
}
