import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { buildOnboardingViewerData } from "./build";
import { layoutGraph, nodeHeight, nodeWidth } from "./layout";

const page = readFileSync(new URL("../../content/docs/guides/view-email-workflows.mdx", import.meta.url), "utf8");

const data = await buildOnboardingViewerData();

function fence(language: string, body: string) {
  return `\`\`\`${language}\n${body}\n\`\`\``;
}

// The page's Markdown mirror is what agents read, so its Mermaid and JSON must match what the
// viewer renders. When the onboarding example or the inspector changes, paste the expected block
// from the failure into content/docs/guides/view-email-workflows.mdx.
test("the guide carries the current Mermaid, day-2 timeline, and JSON graph", () => {
  expect(page).toContain(fence("mermaid", data.mermaid));
  expect(page).toContain(fence("json", JSON.stringify(data.frames[1]?.timeline, null, 2)));
  expect(page).toContain(fence("json", JSON.stringify(data.graph, null, 2)));
});

test("the sample run follows the received branch and ends completed", () => {
  const last = data.frames.at(-1);

  expect(data.frames.map((frame) => frame.atMs)).toEqual([0, 2 * 86_400_000, 3 * 86_400_000]);
  expect(last?.timeline.status).toBe("completed");
  expect(last?.activeNodeId).toBe("activated:received/$end");
  expect(data.frames[1]?.activeNodeId).toBe("activated");
});

test("the layout places every node without overlap, branches side by side", () => {
  const layout = layoutGraph(data.graph);

  expect(layout.nodes).toHaveLength(data.graph.nodes.length);

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
