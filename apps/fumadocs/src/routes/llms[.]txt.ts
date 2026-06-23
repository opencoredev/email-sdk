import { createFileRoute } from "@tanstack/react-router";
import { llms } from "fumadocs-core/source";

import { appName, llmsOverview } from "@/lib/shared";
import { source } from "@/lib/source";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET() {
        // Replace the generated H1 with an enriched header: short description,
        // overview, and agent constraints, then the documentation index.
        const index = llms(source)
          .index()
          .replace(/^#[^\n]*\r?\n+/, "");
        const body = `# ${appName}\n\n${llmsOverview}\n\n## Documentation\n\n${index}`;

        return new Response(body, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
