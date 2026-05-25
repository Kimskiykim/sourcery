import type { GraphNode } from "../core/graph/types.js";

export function getGraphNodeRadius(node: GraphNode, dense: boolean): number {
  if (node.type === "note") {
    if (dense && node.orphan) {
      return 6;
    }

    const minRadius = dense ? 8 : 10;
    const maxRadius = dense ? 17 : 20;
    return Math.max(minRadius, Math.min(maxRadius, Math.floor(8 + node.size * (dense ? 0.6 : 0.75))));
  }

  return node.type === "tag" ? dense ? 7 : 9 : dense ? 6 : 8;
}
