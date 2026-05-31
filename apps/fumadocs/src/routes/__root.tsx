import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import * as React from "react";

import SearchDialog from "@/components/search";
import { siteMeta } from "@/lib/metadata";

import appCss from "@/styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: siteMeta,
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/logo.png" },
      { rel: "apple-touch-icon", href: "/logo.png" },
      {
        rel: "alternate",
        type: "application/rss+xml",
        title: "Email SDK Blog RSS",
        href: "/rss.xml",
      },
      {
        rel: "alternate",
        type: "application/feed+json",
        title: "Email SDK Blog JSON Feed",
        href: "/feed.json",
      },
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
        <Analytics />
        <Scripts />
      </body>
    </html>
  );
}
