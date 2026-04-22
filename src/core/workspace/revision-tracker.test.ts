import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceRevisionTracker } from "./revision-tracker.js";

test("WorkspaceRevisionTracker exposes initial state", () => {
  const tracker = new WorkspaceRevisionTracker();
  const state = tracker.getState();

  assert.equal(state.revision, 1);
  assert.ok(Number.isFinite(Date.parse(state.changedAt)));
  assert.deepEqual(state.connections, []);
  assert.equal(state.activeConnectionId, null);
});

test("WorkspaceRevisionTracker bump increments revision and updates timestamp", () => {
  const tracker = new WorkspaceRevisionTracker();
  const initial = tracker.getState();
  const bumped = tracker.bump(undefined, new Date("2026-04-21T10:15:00.000Z"));

  assert.equal(bumped.revision, initial.revision + 1);
  assert.equal(bumped.changedAt, "2026-04-21T10:15:00.000Z");
});

test("WorkspaceRevisionTracker keeps per-connection revisions", () => {
  const tracker = new WorkspaceRevisionTracker();
  tracker.syncConnections(["default", "docs-repo"], new Date("2026-04-21T09:00:00.000Z"));

  const bumped = tracker.bump("docs-repo", new Date("2026-04-21T10:15:00.000Z"));
  assert.equal(bumped.activeConnectionId, "docs-repo");
  assert.deepEqual(bumped.connections, [
    {
      connectionId: "default",
      revision: 1,
      changedAt: "2026-04-21T09:00:00.000Z",
    },
    {
      connectionId: "docs-repo",
      revision: 2,
      changedAt: "2026-04-21T10:15:00.000Z",
    },
  ]);
});
