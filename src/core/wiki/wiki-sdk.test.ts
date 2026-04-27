import test from "node:test";
import assert from "node:assert/strict";

import { WikiSDK } from "./wiki-sdk.js";
import type { WorkspaceNote } from "../workspace/types.js";

const wiki = new WikiSDK();

test("extractTags returns unique normalized tags", () => {
  const tags = wiki.extractTags(`
    #alpha
    text #beta and #Alpha
    (#roadmap)
    skip C# and keep #tag_1
  `);

  assert.deepEqual(tags, ["alpha", "beta", "roadmap", "tag_1"]);
});

test("extractTags merges inline tags with frontmatter tags", () => {
  const tags = wiki.extractTags(`---
tags:
  - Research
  - inbox/next
aliases: [Graph]
---
#alpha and #research
`);

  assert.deepEqual(tags, ["research", "inbox/next", "alpha"]);
});

test("extractTags supports inline frontmatter tag lists", () => {
  const tags = wiki.extractTags(`---
tags: [backend, "#graph/model"]
---
Body
`);

  assert.deepEqual(tags, ["backend", "graph/model"]);
});

test("getMetadata returns links, backlinks, and tags", () => {
  const target: WorkspaceNote = {
    id: "Target.md",
    title: "Target",
    folderPath: "",
    content: "#target #docs",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  };

  const source: WorkspaceNote = {
    id: "Source.md",
    title: "Source",
    folderPath: "",
    content: "See [[Target]] and #docs",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  };

  const metadata = wiki.getMetadata(target, [target, source]);

  assert.deepEqual(metadata.links, []);
  assert.deepEqual(metadata.backlinks, ["Source.md"]);
  assert.deepEqual(metadata.tags, ["target", "docs"]);
});

test("ambiguous title links stay unresolved while path-qualified links resolve", () => {
  const alphaA: WorkspaceNote = {
    id: "areas/a/Alpha.md",
    title: "Alpha",
    folderPath: "areas/a",
    content: "",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  };
  const alphaB: WorkspaceNote = {
    id: "areas/b/Alpha.md",
    title: "Alpha",
    folderPath: "areas/b",
    content: "",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  };
  const ambiguousSource: WorkspaceNote = {
    id: "Ambiguous.md",
    title: "Ambiguous",
    folderPath: "",
    content: "See [[Alpha]]",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  };
  const exactSource: WorkspaceNote = {
    id: "Exact.md",
    title: "Exact",
    folderPath: "",
    content: "See [[areas/a/Alpha]]",
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
  };

  const notes = [alphaA, alphaB, ambiguousSource, exactSource];
  const metadata = wiki.getMetadata(alphaA, notes);
  const resolvedLinks = wiki.buildResolvedLinks(notes);

  assert.deepEqual(metadata.backlinks, ["Exact.md"]);
  assert.deepEqual(resolvedLinks["Ambiguous.md"], {});
  assert.deepEqual(resolvedLinks["Exact.md"], {
    "areas/a/Alpha.md": 1,
  });
});
