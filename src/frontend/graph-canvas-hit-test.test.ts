import assert from "node:assert/strict";
import test from "node:test";

import { clientPointToGraphPoint, getGraphCanvasViewportTransform, hitTestGraphCanvasNode } from "./graph-canvas-hit-test.js";

test("clientPointToGraphPoint converts browser coordinates into panned graph coordinates", () => {
  assert.deepEqual(
    clientPointToGraphPoint(260, 220, 10, 20, {
      panX: 50,
      panY: 30,
      zoom: 2,
      viewBoxWidth: 1000,
      viewBoxHeight: 680,
      clientWidth: 500,
      clientHeight: 340,
    }),
    {
      x: 225,
      y: 185,
    }
  );
});

test("getGraphCanvasViewportTransform preserves graph aspect ratio in wide containers", () => {
  assert.deepEqual(
    getGraphCanvasViewportTransform({
      panX: 0,
      panY: 0,
      zoom: 1,
      viewBoxWidth: 1000,
      viewBoxHeight: 680,
      clientWidth: 1400,
      clientHeight: 680,
    }),
    {
      scale: 1,
      offsetX: 200,
      offsetY: 0,
    }
  );
});

test("clientPointToGraphPoint accounts for canvas letterboxing", () => {
  assert.deepEqual(
    clientPointToGraphPoint(700, 340, 0, 0, {
      panX: 0,
      panY: 0,
      zoom: 1,
      viewBoxWidth: 1000,
      viewBoxHeight: 680,
      clientWidth: 1400,
      clientHeight: 680,
    }),
    {
      x: 500,
      y: 340,
    }
  );
});

test("hitTestGraphCanvasNode returns the nearest target under the pointer", () => {
  const target = hitTestGraphCanvasNode({ x: 103, y: 100 }, [
    { id: "far", x: 115, y: 100, radius: 20 },
    { id: "near", x: 100, y: 100, radius: 12 },
  ]);

  assert.equal(target?.id, "near");
});

test("hitTestGraphCanvasNode returns null outside all node radii", () => {
  assert.equal(
    hitTestGraphCanvasNode({ x: 150, y: 100 }, [{ id: "node", x: 100, y: 100, radius: 12 }]),
    null
  );
});
