import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { NotFound } from "@/components/not-found";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPreload: "intent",
    defaultPreloadDelay: 0,
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
  });
}
