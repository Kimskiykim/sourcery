import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceNote } from "../workspace/types.js";
import { matchesNoteQuery } from "./query.js";
import type { WikiMetadata } from "./wiki-sdk.js";

const note: WorkspaceNote = {
  id: "Alpha.md",
  title: "Alpha",
  folderPath: "",
  content: "Body text about APIs and graphs",
  createdAt: "2026-04-21T00:00:00.000Z",
  updatedAt: "2026-04-21T00:00:00.000Z",
};

const metadata: WikiMetadata = {
  links: [],
  backlinks: [],
  tags: ["backend", "graph"],
};

test("matchesNoteQuery supports plain text search", () => {
  assert.equal(matchesNoteQuery(note, metadata, "apis"), true);
  assert.equal(matchesNoteQuery(note, metadata, "missing"), false);
});

test("matchesNoteQuery supports metadata-first hashtag filtering", () => {
  assert.equal(matchesNoteQuery(note, metadata, "#backend"), true);
  assert.equal(matchesNoteQuery(note, metadata, "#graph"), true);
  assert.equal(matchesNoteQuery(note, metadata, "#frontend"), false);
});
