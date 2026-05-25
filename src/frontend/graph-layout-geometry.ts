export type GraphLayoutMode = "global" | "local";

export interface GraphLayoutGeometryInput {
  dense: boolean;
  mode: GraphLayoutMode;
}

export interface GraphCoreCenterInput extends GraphLayoutGeometryInput {
  worldHeight: number;
}

export interface GraphRingGeometry {
  baseRadius: number;
  radiusStep: number;
  maxPerRing: number;
  startAngle: number;
}

export interface DenseGraphOrphanInput extends GraphLayoutGeometryInput {
  noteCount: number;
  orphanNoteCount: number;
}

export const GRAPH_LAYOUT_TOP_MARGIN = 48;

export function getGraphCoreCenterY(input: GraphCoreCenterInput): number {
  if (!input.dense || input.mode === "local") {
    return input.worldHeight / 2;
  }

  return Math.min(430, input.worldHeight - 290);
}

export function getGraphRingGeometry(input: GraphLayoutGeometryInput): {
  note: GraphRingGeometry;
  tag: GraphRingGeometry;
  dangling: GraphRingGeometry;
} {
  return {
    note: {
      baseRadius: input.mode === "local" ? 170 : input.dense ? 145 : 120,
      radiusStep: input.dense ? 88 : 78,
      maxPerRing: input.dense ? 16 : 10,
      startAngle: -Math.PI / 2,
    },
    tag: {
      baseRadius: input.mode === "local" ? 300 : input.dense ? 330 : 290,
      radiusStep: input.dense ? 76 : 64,
      maxPerRing: input.dense ? 18 : 14,
      startAngle: -Math.PI / 2 + 0.16,
    },
    dangling: {
      baseRadius: input.mode === "local" ? 390 : input.dense ? 470 : 420,
      radiusStep: 62,
      maxPerRing: input.dense ? 18 : 16,
      startAngle: Math.PI / 2,
    },
  };
}

export function shouldRenderDenseGraphOrphans(input: DenseGraphOrphanInput): boolean {
  return input.orphanNoteCount > 0;
}

export function getGraphOrphanRingGeometry(input: GraphLayoutGeometryInput): GraphRingGeometry {
  return {
    baseRadius: input.mode === "local" ? 320 : input.dense ? 280 : 260,
    radiusStep: input.dense ? 50 : 48,
    maxPerRing: input.dense ? 28 : 18,
    startAngle: -Math.PI / 2 + 0.24,
  };
}
