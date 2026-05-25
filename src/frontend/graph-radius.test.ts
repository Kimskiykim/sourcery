import assert from "node:assert/strict";
import test from "node:test";

import { getGraphNodeRadius } from "./graph-radius.js";
import type { GraphNode } from "../core/graph/types.js";

function noteNode(size: number, orphan = false): GraphNode {
  return {
    id: `note-${size}`,
    label: `Note ${size}`,
    type: "note",
    noteId: `note-${size}.md`,
    degree: Math.max(0, size - 1),
    inDegree: 0,
    outDegree: Math.max(0, size - 1),
    size,
    orphan,
  };
}

test("graph note radius grows gently and caps large connected notes", () => {
  assert.equal(getGraphNodeRadius(noteNode(1), false), 10);
  assert.equal(getGraphNodeRadius(noteNode(8), false), 14);
  assert.equal(getGraphNodeRadius(noteNode(20), false), 20);
  assert.equal(getGraphNodeRadius(noteNode(80), false), 20);
});

test("dense graph note radius uses a lower cap and keeps orphan nodes compact", () => {
  assert.equal(getGraphNodeRadius(noteNode(1), true), 8);
  assert.equal(getGraphNodeRadius(noteNode(12), true), 15);
  assert.equal(getGraphNodeRadius(noteNode(80), true), 17);
  assert.equal(getGraphNodeRadius(noteNode(1, true), true), 6);
});

test("non-note graph node radii stay stable", () => {
  const tagNode: GraphNode = {
    id: "tag:project",
    label: "#project",
    type: "tag",
    tag: "project",
    degree: 3,
    inDegree: 3,
    outDegree: 0,
    size: 4,
  };
  const danglingNode: GraphNode = {
    id: "dangling:missing",
    label: "missing",
    type: "dangling",
    unresolved: true,
    degree: 1,
    inDegree: 1,
    outDegree: 0,
    size: 2,
  };

  assert.equal(getGraphNodeRadius(tagNode, false), 9);
  assert.equal(getGraphNodeRadius(tagNode, true), 7);
  assert.equal(getGraphNodeRadius(danglingNode, false), 8);
  assert.equal(getGraphNodeRadius(danglingNode, true), 6);
});
