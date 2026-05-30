import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import * as React from "react";

import SearchDialog from "@/components/search";
import { appDescription, appName, siteOgImageUrl, siteUrl } from "@/lib/shared";

import appCss from "@/styles/app.css?url";

const siteTitle = `${appName} - Unified email sending for TypeScript`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
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
      {
        property: "og:type",
        content: "website",
      },
      {
        property: "og:title",
        content: "Email SDK - Unified email sending for TypeScript",
      },
      {
        property: "og:description",
        content:
          "A lightweight TypeScript SDK for unified email sending with Resend, SMTP, Postmark, fallbacks, hooks, and a Bun CLI.",
      },
      {
        property: "og:image",
        content: "/apple-touch-icon.png",
      },
      {
        name: "twitter:card",
        content: "summary",
      },
      {
        name: "twitter:image",
        content: "/apple-touch-icon.png",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider search={{ SearchDialog }}>
          <Outlet />
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
