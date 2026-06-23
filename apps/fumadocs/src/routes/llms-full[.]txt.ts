import { createFileRoute } from "@tanstack/react-router";

import { appName, llmsOverview } from "@/lib/shared";
import { source, getLLMText } from "@/lib/source";

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () => {
        const scan = source.getPages().map((page) => getLLMText(page));
        const scanned = await Promise.all(scan);
        const body = `# ${appName}\n\n${llmsOverview}\n\n---\n\n${scanned.join("\n\n")}`;

        return new Response(body, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
