import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { NotFound } from "@/components/not-found";
import { PageSpinner } from "@/components/spinner";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    defaultPreloadDelay: 0,
    defaultPendingComponent: PageSpinner,
    defaultPendingMs: 120,
    defaultPendingMinMs: 200,
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
  });
}
