import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { buildOnboardingViewerData } from "./build";
import { layoutGraph, nodeHeight, nodeWidth } from "./layout";
import { onboardingViewerData } from "./onboarding.generated";

const page = readFileSync(new URL("../../../content/docs/guides/view-email-workflows.mdx", import.meta.url), "utf8");

test("the committed snapshot matches a fresh build of the onboarding example", async () => {
  // Run `bun run workflow-viewer:generate` when this fails.
  expect(onboardingViewerData).toEqual(await buildOnboardingViewerData());
});

test("the guide's markdown carries the same Mermaid and JSON graph", () => {
  expect(page).toContain(`\`\`\`mermaid\n${onboardingViewerData.mermaid}\n\`\`\``);
  expect(page).toContain(`\`\`\`json\n${JSON.stringify(onboardingViewerData.graph, null, 2)}\n\`\`\``);
});

test("the sample run follows the received branch and ends completed", () => {
  const last = onboardingViewerData.frames.at(-1);

  expect(onboardingViewerData.frames.map((frame) => frame.atMs)).toEqual([0, 2 * 86_400_000, 3 * 86_400_000]);
  expect(last?.timeline.status).toBe("completed");
  expect(last?.activeNodeId).toBe("activated:received/end");
  expect(onboardingViewerData.frames[1]?.activeNodeId).toBe("activated");
});

test("the layout places every node without overlap, branches side by side", () => {
  const layout = layoutGraph(onboardingViewerData.graph);

  expect(layout.nodes).toHaveLength(onboardingViewerData.graph.nodes.length);

  for (const a of layout.nodes) {
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x + nodeWidth).toBeLessThanOrEqual(layout.width);
    expect(a.y + nodeHeight).toBeLessThanOrEqual(layout.height);

    for (const b of layout.nodes) {
      if (a === b) continue;

      const apart = a.x + nodeWidth <= b.x || b.x + nodeWidth <= a.x || a.y + nodeHeight <= b.y || b.y + nodeHeight <= a.y;

      expect(apart).toBe(true);
    }
  }

  const received = layout.byId.get("activated:received/activated-mail");
  const timeout = layout.byId.get("activated:timeout/nudge");
  const wait = layout.byId.get("activated");

  expect(received && timeout && wait && received.x < wait.x && wait.x < timeout.x).toBe(true);
});
