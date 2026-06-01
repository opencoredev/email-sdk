import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET() {
        return Response.json({
          ok: true,
          service: "email-sdk-docs",
        });
      },
    },
  },
});
