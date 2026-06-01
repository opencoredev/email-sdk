import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { NotFound } from "@/components/not-found";
import { AppErrorPage } from "@/components/recovery-page";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    defaultPreloadDelay: 0,
    scrollRestoration: true,
    defaultErrorComponent: AppErrorPage,
    defaultNotFoundComponent: NotFound,
  });
}
