import assert from "node:assert/strict";
import test from "node:test";

import {
  GRAPH_LAYOUT_TOP_MARGIN,
  getGraphCoreCenterY,
  getGraphOrphanRingGeometry,
  getGraphRingGeometry,
  shouldRenderDenseGraphOrphans,
} from "./graph-layout-geometry.js";

test("global graph rings start below the top simulation boundary", () => {
  const centerY = getGraphCoreCenterY({
    dense: false,
    mode: "global",
    worldHeight: 680,
  });
  const rings = getGraphRingGeometry({ dense: false, mode: "global" });

  assert.ok(centerY + Math.sin(rings.note.startAngle) * rings.note.baseRadius >= GRAPH_LAYOUT_TOP_MARGIN);
  assert.ok(centerY + Math.sin(rings.tag.startAngle) * rings.tag.baseRadius >= GRAPH_LAYOUT_TOP_MARGIN);
});

test("dense global graph rings start below the top simulation boundary", () => {
  const centerY = getGraphCoreCenterY({
    dense: true,
    mode: "global",
    worldHeight: 720,
  });
  const rings = getGraphRingGeometry({ dense: true, mode: "global" });

  assert.ok(centerY + Math.sin(rings.note.startAngle) * rings.note.baseRadius >= GRAPH_LAYOUT_TOP_MARGIN);
  assert.ok(centerY + Math.sin(rings.tag.startAngle) * rings.tag.baseRadius >= GRAPH_LAYOUT_TOP_MARGIN);
});

test("local graph keeps the selected note centered in the viewbox", () => {
  assert.equal(
    getGraphCoreCenterY({
      dense: false,
      mode: "local",
      worldHeight: 680,
    }),
    340
  );
});

test("dense mixed graph keeps orphan notes in the main canvas", () => {
  assert.equal(
    shouldRenderDenseGraphOrphans({
      dense: true,
      mode: "global",
      noteCount: 100,
      orphanNoteCount: 71,
    }),
    true
  );
});

test("dense orphan-only graph renders orphan notes for the focused lens", () => {
  assert.equal(
    shouldRenderDenseGraphOrphans({
      dense: true,
      mode: "global",
      noteCount: 71,
      orphanNoteCount: 71,
    }),
    true
  );
});

test("dense orphan rings start below the top simulation boundary", () => {
  const centerY = getGraphCoreCenterY({
    dense: true,
    mode: "global",
    worldHeight: 1164,
  });
  const ring = getGraphOrphanRingGeometry({ dense: true, mode: "global" });

  assert.ok(centerY - ring.baseRadius >= GRAPH_LAYOUT_TOP_MARGIN);
});

test("dense orphan outer rings stay below the top simulation boundary", () => {
  const orphanCount = 71;
  const centerY = getGraphCoreCenterY({
    dense: true,
    mode: "global",
    worldHeight: 1164,
  });
  const ring = getGraphOrphanRingGeometry({ dense: true, mode: "global" });
  const outerRing = Math.ceil(orphanCount / ring.maxPerRing) - 1;
  const outerRadius = ring.baseRadius + outerRing * ring.radiusStep;

  assert.ok(centerY - outerRadius >= GRAPH_LAYOUT_TOP_MARGIN);
});
