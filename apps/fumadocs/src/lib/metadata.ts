import type { MetaDescriptor } from "@tanstack/react-router";

import { appDescription, appName, siteOgImageUrl, siteUrl } from "@/lib/shared";

export const siteTitle = `${appName} - Unified email sending for TypeScript`;

export const siteMeta = [
  {
    charSet: "utf-8",
  },
  {
    name: "viewport",
    content: "width=device-width, initial-scale=1",
  },
  {
    title: siteTitle,
  },
  {
    name: "description",
    content: appDescription,
  },
  {
    property: "og:type",
    content: "website",
  },
  {
    property: "og:title",
    content: siteTitle,
  },
  {
    property: "og:url",
    content: siteUrl,
  },
  {
    property: "og:description",
    content: appDescription,
  },
  {
    property: "og:image",
    content: siteOgImageUrl,
  },
  {
    property: "og:image:width",
    content: "1200",
  },
  {
    property: "og:image:height",
    content: "630",
  },
  {
    name: "twitter:card",
    content: "summary_large_image",
  },
  {
    name: "twitter:title",
    content: siteTitle,
  },
  {
    name: "twitter:description",
    content: appDescription,
  },
  {
    name: "twitter:image",
    content: siteOgImageUrl,
  },
  {
    name: "robots",
    content: "index, follow",
  },
] satisfies MetaDescriptor[];
