import type { WorkflowInspectGraph, WorkflowInspectNode } from "@opencoredev/email-sdk/workflows";

export const nodeWidth = 248;

export const nodeHeight = 68;

const gapX = 40;

const gapY = 44;

const padding = 24;

export type PlacedNode = { node: WorkflowInspectNode; x: number; y: number; depth: number };

export type PlacedEdge = { from: PlacedNode; to: PlacedNode; branch?: "received" | "timeout" };

export type GraphLayout = {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
  byId: Map<string, PlacedNode>;
  parentOf: Map<string, string>;
  childrenOf: Map<string, string[]>;
};

/**
 * Lays an inspected graph out top to bottom. The inspector's node ids make the graph a tree rooted
 * at the trigger, so each subtree gets as many columns as it has leaves and a parent sits centered
 * over its children. Branch children keep edge order: received left, timeout right.
 */
export function layoutGraph(graph: WorkflowInspectGraph): GraphLayout {
  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();

  for (const edge of graph.edges) {
    childrenOf.set(edge.from, [...(childrenOf.get(edge.from) ?? []), edge.to]);
    parentOf.set(edge.to, edge.from);
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const leaves = new Map<string, number>();

  function countLeaves(id: string): number {
    const children = childrenOf.get(id) ?? [];
    const count = children.length === 0 ? 1 : children.reduce((sum, child) => sum + countLeaves(child), 0);

    leaves.set(id, count);

    return count;
  }

  const rootId = graph.nodes[0]?.id ?? "trigger";
  const columns = countLeaves(rootId);
  const byId = new Map<string, PlacedNode>();
  let maxDepth = 0;

  function place(id: string, firstColumn: number, depth: number) {
    const node = nodesById.get(id);

    if (!node) return;

    const span = leaves.get(id) ?? 1;
    const centerColumn = firstColumn + span / 2;

    // Each column is one node wide plus the gap after it; the last gap is trimmed from the width.
    const centerX = padding + centerColumn * (nodeWidth + gapX) - gapX / 2;

    byId.set(id, { node, depth, x: centerX - nodeWidth / 2, y: padding + depth * (nodeHeight + gapY) });
    maxDepth = Math.max(maxDepth, depth);

    let column = firstColumn;

    for (const child of childrenOf.get(id) ?? []) {
      place(child, column, depth + 1);
      column += leaves.get(child) ?? 1;
    }
  }

  place(rootId, 0, 0);

  const nodes = graph.nodes.flatMap((node) => {
    const placed = byId.get(node.id);

    return placed ? [placed] : [];
  });

  const edges = graph.edges.flatMap((edge): PlacedEdge[] => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);

    if (!from || !to) return [];

    return edge.branch ? [{ from, to, branch: edge.branch }] : [{ from, to }];
  });

  return {
    nodes,
    edges,
    byId,
    parentOf,
    childrenOf,
    width: padding * 2 + columns * nodeWidth + (columns - 1) * gapX,
    height: padding * 2 + (maxDepth + 1) * nodeHeight + maxDepth * gapY,
  };
}
