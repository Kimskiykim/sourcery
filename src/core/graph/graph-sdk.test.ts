import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { WorkspaceNote } from "../workspace/types.js";
import { GraphSDK, WorkspaceTabsSessionStore } from "./graph-sdk.js";

const graph = new GraphSDK();

const notes: WorkspaceNote[] = [
  {
    id: "projects/Alpha.md",
    title: "Alpha",
    folderPath: "projects",
    content: "[[Beta]] [[Missing]] #project",
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
  },
  {
    id: "projects/Beta.md",
    title: "Beta",
    folderPath: "projects",
    content: "[[Gamma]] #project",
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
  },
  {
    id: "archive/Gamma.md",
    title: "Gamma",
    folderPath: "archive",
    content: "[[Delta]] [[Alpha]] #deep",
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
  },
  {
    id: "archive/Delta.md",
    title: "Delta",
    folderPath: "archive",
    content: "#deep",
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
  },
  {
    id: "scratch/Orphan.md",
    title: "Orphan",
    folderPath: "scratch",
    content: `---
tags: [solo]
---
No links here`,
    createdAt: "2026-04-21T00:00:00.000Z",
    updatedAt: "2026-04-21T00:00:00.000Z",
  },
];

test("buildGlobalGraph derives note tag and dangling nodes from markdown", () => {
  const snapshot = graph.buildGlobalGraph(notes);

  assert.equal(snapshot.stats.noteCount, 5);
  assert.equal(snapshot.stats.tagCount, 3);
  assert.equal(snapshot.stats.danglingCount, 1);
  assert.equal(snapshot.stats.orphanNoteCount, 1);
  assert.equal(snapshot.stats.edgeCount, 10);

  const alpha = snapshot.nodes.find((node) => node.id === "projects/Alpha.md");
  assert.deepEqual(
    alpha && {
      label: alpha.label,
      type: alpha.type,
      degree: alpha.degree,
      outDegree: alpha.outDegree,
      size: alpha.size,
    },
    {
      label: "Alpha",
      type: "note",
      degree: 4,
      outDegree: 3,
      size: 5,
    }
  );

  assert.ok(snapshot.nodes.some((node) => node.id === "tag:project" && node.type === "tag"));
  assert.ok(snapshot.nodes.some((node) => node.id === "dangling:missing" && node.type === "dangling"));
  assert.ok(
    snapshot.edges.some((edge) =>
      edge.source === "projects/Alpha.md" &&
      edge.target === "projects/Beta.md" &&
      edge.kind === "wikilink"
    )
  );
});

test("buildGlobalGraph filters graph by folder subtree", () => {
  const snapshot = graph.buildGlobalGraph(notes, { folderPath: "projects" });

  assert.deepEqual(
    snapshot.nodes.map((node) => node.id),
    [
      "projects/Alpha.md",
      "projects/Beta.md",
      "tag:project",
      "dangling:missing",
    ]
  );
  assert.equal(snapshot.stats.edgeCount, 4);
});

test("buildGlobalGraph supports existingFilesOnly and hiding orphans", () => {
  const snapshot = graph.buildGlobalGraph(notes, {
    existingFilesOnly: true,
    includeOrphans: false,
  });

  assert.equal(snapshot.nodes.some((node) => node.id === "dangling:missing"), false);
  assert.equal(snapshot.nodes.some((node) => node.id === "scratch/Orphan.md"), false);
  assert.equal(snapshot.stats.danglingCount, 0);
  assert.equal(snapshot.stats.orphanNoteCount, 0);
});

test("buildLocalGraph returns neighborhood around note with bounded depth", () => {
  const snapshot = graph.buildLocalGraph(notes, "projects/Beta.md", { depth: 1 });

  assert.deepEqual(
    snapshot.nodes.map((node) => node.id),
    [
      "projects/Alpha.md",
      "projects/Beta.md",
      "archive/Gamma.md",
      "tag:deep",
      "tag:project",
      "dangling:missing",
    ]
  );
  assert.equal(snapshot.nodes.some((node) => node.id === "archive/Delta.md"), false);
  assert.ok(
    snapshot.edges.some((edge) =>
      edge.source === "archive/Gamma.md" &&
      edge.target === "projects/Alpha.md" &&
      edge.kind === "wikilink"
    )
  );
});

test("getOrphans returns notes without note-to-note graph connections", () => {
  const orphans = graph.getOrphans(notes);

  assert.deepEqual(orphans.map((note) => note.id), ["scratch/Orphan.md"]);
});

test("getBrokenLinks returns unresolved wikilinks with occurrence counts", () => {
  const brokenLinks = graph.getBrokenLinks(notes);

  assert.deepEqual(brokenLinks, [
    {
      sourceNoteId: "projects/Alpha.md",
      sourceTitle: "Alpha",
      sourceFolderPath: "projects",
      linkText: "Missing",
      occurrences: 1,
    },
  ]);
});

test("getNeighbors returns incoming and outgoing note relations", () => {
  const neighbors = graph.getNeighbors(notes, "projects/Alpha.md");

  assert.deepEqual(neighbors, [
    {
      noteId: "archive/Gamma.md",
      title: "Gamma",
      folderPath: "archive",
      direction: "incoming",
      weight: 1,
    },
    {
      noteId: "projects/Beta.md",
      title: "Beta",
      folderPath: "projects",
      direction: "outgoing",
      weight: 1,
    },
  ]);
});

test("getShortestPath returns the shortest note-to-note path", () => {
  const path = graph.getShortestPath(notes, "projects/Beta.md", "archive/Delta.md");

  assert.deepEqual(path, {
    found: true,
    distance: 2,
    nodes: [
      {
        noteId: "projects/Beta.md",
        title: "Beta",
        folderPath: "projects",
      },
      {
        noteId: "archive/Gamma.md",
        title: "Gamma",
        folderPath: "archive",
      },
      {
        noteId: "archive/Delta.md",
        title: "Delta",
        folderPath: "archive",
      },
    ],
  });
});

test("getShortestPath returns not found across disconnected clusters", () => {
  const path = graph.getShortestPath(notes, "projects/Alpha.md", "scratch/Orphan.md");

  assert.deepEqual(path, {
    found: false,
    distance: null,
    nodes: [],
  });
});

test("getClusters returns connected note components with folders and tags", () => {
  const clusters = graph.getClusters(notes);

  assert.deepEqual(clusters, [
    {
      id: "cluster:archive/Delta.md",
      size: 4,
      noteIds: [
        "archive/Delta.md",
        "archive/Gamma.md",
        "projects/Alpha.md",
        "projects/Beta.md",
      ],
      folders: ["archive", "projects"],
      tags: ["deep", "project"],
    },
    {
      id: "cluster:scratch/Orphan.md",
      size: 1,
      noteIds: ["scratch/Orphan.md"],
      folders: ["scratch"],
      tags: ["solo"],
    },
  ]);
});

test("tabs session opens notes without duplicates and exposes active note metadata", () => {
  const session = new WorkspaceTabsSessionStore();

  const opened = session.openNote(notes, { noteId: "projects/Alpha.md" });
  assert.deepEqual(opened, {
    tabs: [
      {
        id: "projects/Alpha.md",
        noteId: "projects/Alpha.md",
        title: "Alpha",
        folderPath: "projects",
        pinned: false,
        connectionId: "default",
        connectionName: "Vault",
      },
    ],
    activeTabId: "projects/Alpha.md",
    activeNoteId: "projects/Alpha.md",
    activeConnectionId: "default",
    updatedAt: opened.updatedAt,
  });

  const reopened = session.openNote(notes, {
    noteId: "projects/Alpha.md",
    pinned: true,
  });
  assert.equal(reopened.tabs.length, 1);
  assert.equal(reopened.tabs[0]?.pinned, true);
  assert.equal(reopened.activeNoteId, "projects/Alpha.md");
});

test("tabs session can replace the active tab instead of opening a new one", () => {
  const session = new WorkspaceTabsSessionStore();

  session.openNote(notes, { noteId: "projects/Alpha.md" });
  const replaced = session.openNote(notes, {
    noteId: "projects/Beta.md",
    replaceActive: true,
  });

  assert.deepEqual(
    replaced.tabs.map((tab) => ({
      id: tab.id,
      noteId: tab.noteId,
      title: tab.title,
    })),
    [{
      id: "projects/Beta.md",
      noteId: "projects/Beta.md",
      title: "Beta",
    }]
  );
  assert.equal(replaced.activeTabId, "projects/Beta.md");
  assert.equal(replaced.activeNoteId, "projects/Beta.md");
});

test("tabs session can open a duplicate tab when forced explicitly", () => {
  const session = new WorkspaceTabsSessionStore();

  session.openNote(notes, { noteId: "projects/Alpha.md" });
  const duplicated = session.openNote(notes, {
    noteId: "projects/Alpha.md",
    forceNew: true,
  });

  assert.deepEqual(
    duplicated.tabs.map((tab) => tab.id),
    ["projects/Alpha.md", "projects/Alpha.md::2"]
  );
  assert.equal(duplicated.activeTabId, "projects/Alpha.md::2");
  assert.equal(duplicated.activeNoteId, "projects/Alpha.md");
});

test("tabs session reorders activates and closes tabs predictably", () => {
  const session = new WorkspaceTabsSessionStore();

  session.openNote(notes, { noteId: "projects/Alpha.md" });
  session.openNote(notes, { noteId: "projects/Beta.md" });
  session.openNote(notes, { noteId: "archive/Gamma.md" });

  const reordered = session.reorderTabs(notes, {
    tabIds: ["archive/Gamma.md", "projects/Alpha.md", "projects/Beta.md"],
  });
  assert.deepEqual(
    reordered.tabs.map((tab) => tab.id),
    ["archive/Gamma.md", "projects/Alpha.md", "projects/Beta.md"]
  );

  const activated = session.activateTab(notes, { tabId: "projects/Alpha.md" });
  assert.equal(activated.activeTabId, "projects/Alpha.md");
  assert.equal(activated.activeNoteId, "projects/Alpha.md");

  const closed = session.closeTab(notes, { tabId: "projects/Alpha.md" });
  assert.deepEqual(
    closed.tabs.map((tab) => tab.id),
    ["archive/Gamma.md", "projects/Beta.md"]
  );
  assert.equal(closed.activeTabId, "projects/Beta.md");
});

test("tabs session syncs renamed and deleted notes from markdown source of truth", () => {
  const session = new WorkspaceTabsSessionStore();

  session.openNote(notes, { noteId: "projects/Beta.md", pinned: true });

  const syncedAfterRename = session.getSnapshot([
    ...notes.filter((note) => note.id !== "projects/Beta.md"),
    {
      ...notes.find((note) => note.id === "projects/Beta.md")!,
      title: "Beta Renamed",
      folderPath: "archive/renamed",
    },
  ]);
  assert.deepEqual(syncedAfterRename.tabs, [
    {
      id: "projects/Beta.md",
      noteId: "projects/Beta.md",
      title: "Beta Renamed",
      folderPath: "archive/renamed",
      pinned: true,
      connectionId: "default",
      connectionName: "Vault",
    },
  ]);

  const syncedAfterDelete = session.getSnapshot(
    notes.filter((note) => note.id !== "projects/Beta.md")
  );
  assert.deepEqual(syncedAfterDelete.tabs, []);
  assert.equal(syncedAfterDelete.activeTabId, null);
  assert.equal(syncedAfterDelete.activeNoteId, null);
});

test("tabs session returns an empty workspace after closing the last tab", () => {
  const session = new WorkspaceTabsSessionStore();

  session.openNote(notes, { noteId: "projects/Alpha.md" });
  const closed = session.closeTab(notes, { tabId: "projects/Alpha.md" });

  assert.deepEqual(closed.tabs, []);
  assert.equal(closed.activeTabId, null);
  assert.equal(closed.activeNoteId, null);
  assert.equal(closed.activeConnectionId, null);
});

test("tabs session persists desktop state to disk when configured", async (t) => {
  const appStateDir = await mkdtemp(path.join(tmpdir(), "sourcery-tabs-session-"));
  t.after(async () => {
    await rm(appStateDir, { recursive: true, force: true });
  });

  const stateFilePath = path.join(appStateDir, "workspace-tabs-session.json");
  const firstSession = new WorkspaceTabsSessionStore({ stateFilePath });
  firstSession.openNote(notes, { noteId: "projects/Alpha.md" });
  firstSession.openNote(notes, { noteId: "archive/Gamma.md", pinned: true });

  const secondSession = new WorkspaceTabsSessionStore({ stateFilePath });
  const snapshot = secondSession.getSnapshot(notes);

  assert.deepEqual(snapshot.tabs, [
    {
      id: "projects/Alpha.md",
      noteId: "projects/Alpha.md",
      title: "Alpha",
      folderPath: "projects",
      pinned: false,
      connectionId: "default",
      connectionName: "Vault",
    },
    {
      id: "archive/Gamma.md",
      noteId: "archive/Gamma.md",
      title: "Gamma",
      folderPath: "archive",
      pinned: true,
      connectionId: "default",
      connectionName: "Vault",
    },
  ]);
  assert.equal(snapshot.activeTabId, "archive/Gamma.md");
  assert.equal(snapshot.activeConnectionId, "default");
});

test("getClusters respects folder filters", () => {
  const clusters = graph.getClusters(notes, { folderPath: "projects" });

  assert.deepEqual(clusters, [
    {
      id: "cluster:projects/Alpha.md",
      size: 2,
      noteIds: [
        "projects/Alpha.md",
        "projects/Beta.md",
      ],
      folders: ["projects"],
      tags: ["project"],
    },
  ]);
});

test("getTopLinkedNotes ranks notes by incoming resolved links", () => {
  const ranked = graph.getTopLinkedNotes(notes, {}, 3);

  assert.deepEqual(ranked, [
    {
      noteId: "archive/Delta.md",
      title: "Delta",
      folderPath: "archive",
      score: 1,
      inboundLinks: 1,
      outboundLinks: 0,
      neighborCount: 1,
      neighborFolderCount: 1,
    },
    {
      noteId: "archive/Gamma.md",
      title: "Gamma",
      folderPath: "archive",
      score: 1,
      inboundLinks: 1,
      outboundLinks: 2,
      neighborCount: 3,
      neighborFolderCount: 2,
    },
    {
      noteId: "projects/Alpha.md",
      title: "Alpha",
      folderPath: "projects",
      score: 1,
      inboundLinks: 1,
      outboundLinks: 1,
      neighborCount: 2,
      neighborFolderCount: 2,
    },
  ]);
});

test("getHubNotes ranks notes by graph connectivity", () => {
  const ranked = graph.getHubNotes(notes, {}, 2);

  assert.deepEqual(ranked, [
    {
      noteId: "archive/Gamma.md",
      title: "Gamma",
      folderPath: "archive",
      score: 33,
      inboundLinks: 1,
      outboundLinks: 2,
      neighborCount: 3,
      neighborFolderCount: 2,
    },
    {
      noteId: "projects/Alpha.md",
      title: "Alpha",
      folderPath: "projects",
      score: 22,
      inboundLinks: 1,
      outboundLinks: 1,
      neighborCount: 2,
      neighborFolderCount: 2,
    },
  ]);
});

test("getBridgeNotes highlights notes whose removal splits the graph", () => {
  const ranked = graph.getBridgeNotes(notes);

  assert.deepEqual(ranked, [
    {
      noteId: "archive/Gamma.md",
      title: "Gamma",
      folderPath: "archive",
      score: 2,
      inboundLinks: 1,
      outboundLinks: 2,
      neighborCount: 3,
      neighborFolderCount: 2,
      disconnectedGroups: 2,
    },
  ]);
});

test("ambiguous wikilinks do not resolve to the first duplicate title", () => {
  const duplicateNotes: WorkspaceNote[] = [
    {
      id: "areas/a/Alpha.md",
      title: "Alpha",
      folderPath: "areas/a",
      content: "",
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
    },
    {
      id: "areas/b/Alpha.md",
      title: "Alpha",
      folderPath: "areas/b",
      content: "",
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
    },
    {
      id: "Ambiguous.md",
      title: "Ambiguous",
      folderPath: "",
      content: "[[Alpha]]",
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
    },
    {
      id: "Exact.md",
      title: "Exact",
      folderPath: "",
      content: "[[areas/a/Alpha]]",
      createdAt: "2026-04-21T00:00:00.000Z",
      updatedAt: "2026-04-21T00:00:00.000Z",
    },
  ];

  const snapshot = graph.buildGlobalGraph(duplicateNotes, { includeTags: false });
  const brokenLinks = graph.getBrokenLinks(duplicateNotes);
  const alphaNeighbors = graph.getNeighbors(duplicateNotes, "areas/a/Alpha.md");

  assert.equal(
    snapshot.edges.some((edge) => edge.source === "Ambiguous.md" && edge.target === "areas/a/Alpha.md"),
    false
  );
  assert.equal(
    snapshot.edges.some((edge) => edge.source === "Ambiguous.md" && edge.target === "areas/b/Alpha.md"),
    false
  );
  assert.equal(
    snapshot.edges.some((edge) => edge.source === "Exact.md" && edge.target === "areas/a/Alpha.md"),
    true
  );
  assert.ok(snapshot.nodes.some((node) => node.id === "dangling:alpha"));
  assert.deepEqual(brokenLinks, [
    {
      sourceNoteId: "Ambiguous.md",
      sourceTitle: "Ambiguous",
      sourceFolderPath: "",
      linkText: "Alpha",
      occurrences: 1,
    },
  ]);
  assert.deepEqual(alphaNeighbors, [
    {
      noteId: "Exact.md",
      title: "Exact",
      folderPath: "",
      direction: "incoming",
      weight: 1,
    },
  ]);
});
