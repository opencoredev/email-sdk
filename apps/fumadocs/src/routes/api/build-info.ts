import { createFileRoute } from "@tanstack/react-router";

import { currentBuildInfo } from "@/lib/build-info";

export const Route = createFileRoute("/api/build-info")({
  server: {
    handlers: {
      GET: () =>
        Response.json(currentBuildInfo, {
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        }),
    },
  },
});
