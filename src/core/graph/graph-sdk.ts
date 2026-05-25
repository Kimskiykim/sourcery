import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { WorkspaceNote } from "../workspace/types.js";
import { WikiSDK } from "../wiki/wiki-sdk.js";
import type {
  ActivateWorkspaceTabInput,
  CloseWorkspaceTabInput,
  WorkspaceConnection,
  GraphBridgeNote,
  GraphBuildOptions,
  GraphBrokenLink,
  GraphCluster,
  GraphEdge,
  GraphEdgeKind,
  GraphNeighbor,
  GraphPathResult,
  GraphRankedNote,
  GraphNode,
  GraphNodeType,
  GraphSnapshot,
  LocalGraphOptions,
  OpenWorkspaceTabInput,
  ReorderWorkspaceTabsInput,
  SetWorkspaceTabPinnedInput,
  WorkspaceTab,
  WorkspaceTabsSessionSnapshot,
} from "./types.js";

type GraphNodeDraft = Omit<GraphNode, "degree" | "inDegree" | "outDegree" | "size">;

type WorkspaceTabsSessionStoreOptions = {
  stateFilePath?: string;
  defaultConnection?: WorkspaceConnection;
  resolveConnection?: (connectionId: string) => WorkspaceConnection | undefined;
  now?: () => Date;
};

export class WorkspaceTabsSessionStore {
  private readonly defaultConnection: WorkspaceConnection;
  private readonly resolveConnection: (connectionId: string) => WorkspaceConnection | undefined;
  private readonly now: () => Date;
  private snapshot: WorkspaceTabsSessionSnapshot;

  constructor(private readonly options: WorkspaceTabsSessionStoreOptions = {}) {
    this.defaultConnection = options.defaultConnection ?? {
      id: "default",
      name: "Vault",
      kind: "vault",
      rootPath: "",
      isDefault: true,
    };
    this.resolveConnection = options.resolveConnection ?? ((connectionId) =>
      connectionId === this.defaultConnection.id ? this.defaultConnection : undefined
    );
    this.now = options.now ?? (() => new Date());
    this.snapshot = this.loadSnapshot();
  }

  getSnapshot(
    notes: WorkspaceNote[],
    connectionId = this.defaultConnection.id
  ): WorkspaceTabsSessionSnapshot {
    this.syncConnectionNotes(notes, connectionId);
    return cloneWorkspaceTabsSessionSnapshot(this.snapshot);
  }

  openNote(notes: WorkspaceNote[], input: OpenWorkspaceTabInput): WorkspaceTabsSessionSnapshot {
    const connection = this.getConnection(input.connectionId);
    this.syncConnectionNotes(notes, connection.id);
    const note = notes.find((item) => item.id === input.noteId);
    if (!note) {
      throw new Error(`Unknown note: ${input.noteId}`);
    }

    const baseTabId = createWorkspaceTabId(connection.id, note.id, this.defaultConnection.id);
    const existingTab = input.forceNew !== true
      ? this.snapshot.tabs.find((tab) => tab.id === baseTabId)
      : undefined;
    const activeTab = this.snapshot.tabs.find((tab) => tab.id === this.snapshot.activeTabId);

    if (existingTab) {
      existingTab.title = note.title;
      existingTab.folderPath = note.folderPath;
      existingTab.connectionId = connection.id;
      existingTab.connectionName = connection.name;

      if (input.pinned !== undefined) {
        existingTab.pinned = input.pinned;
      }

      if (input.activate ?? true) {
        this.snapshot.activeTabId = existingTab.id;
      }

      this.touch();
      return cloneWorkspaceTabsSessionSnapshot(this.snapshot);
    }

    if (input.replaceActive && activeTab) {
      const duplicateTargetTab = this.snapshot.tabs.find((tab) => tab.id === baseTabId && tab.id !== activeTab.id);
      if (duplicateTargetTab) {
        if (!activeTab.pinned) {
          this.snapshot.tabs = this.snapshot.tabs.filter((tab) => tab.id !== activeTab.id);
        }
        this.snapshot.activeTabId = duplicateTargetTab.id;
        this.touch();
        return cloneWorkspaceTabsSessionSnapshot(this.snapshot);
      }

      activeTab.id = baseTabId;
      activeTab.noteId = note.id;
      activeTab.title = note.title;
      activeTab.folderPath = note.folderPath;
      activeTab.connectionId = connection.id;
      activeTab.connectionName = connection.name;
      if (input.pinned !== undefined) {
        activeTab.pinned = input.pinned;
      }
      this.snapshot.activeTabId = activeTab.id;
      this.touch();
      return cloneWorkspaceTabsSessionSnapshot(this.snapshot);
    }

    const tabId = input.forceNew === true
      ? createUniqueWorkspaceTabId(baseTabId, this.snapshot.tabs)
      : baseTabId;

    this.snapshot.tabs.push({
      id: tabId,
      noteId: note.id,
      title: note.title,
      folderPath: note.folderPath,
      pinned: input.pinned ?? false,
      connectionId: connection.id,
      connectionName: connection.name,
    });
    if (input.activate ?? true) {
      this.snapshot.activeTabId = tabId;
    } else if (!this.snapshot.activeTabId) {
      this.snapshot.activeTabId = tabId;
    }

    this.touch();
    return cloneWorkspaceTabsSessionSnapshot(this.snapshot);
  }

  closeTab(notes: WorkspaceNote[], input: CloseWorkspaceTabInput): WorkspaceTabsSessionSnapshot {
    const index = this.snapshot.tabs.findIndex((tab) => tab.id === input.tabId);
    if (index === -1) {
      throw new Error(`Unknown tab: ${input.tabId}`);
    }

    const wasActive = this.snapshot.activeTabId === input.tabId;
    this.snapshot.tabs.splice(index, 1);

    if (wasActive) {
      const fallbackTab = this.snapshot.tabs[index] ?? this.snapshot.tabs[index - 1] ?? null;
      this.snapshot.activeTabId = fallbackTab?.id ?? null;
    } else if (!this.snapshot.tabs.some((tab) => tab.id === this.snapshot.activeTabId)) {
      this.snapshot.activeTabId = this.snapshot.tabs[0]?.id ?? null;
    }

    this.touch();
    return cloneWorkspaceTabsSessionSnapshot(this.snapshot);
  }

  setPinned(notes: WorkspaceNote[], input: SetWorkspaceTabPinnedInput): WorkspaceTabsSessionSnapshot {
    const tab = this.snapshot.tabs.find((item) => item.id === input.tabId);
    if (!tab) {
      throw new Error(`Unknown tab: ${input.tabId}`);
    }

    if (tab.pinned !== input.pinned) {
      tab.pinned = input.pinned;
      this.touch();
    }

    return cloneWorkspaceTabsSessionSnapshot(this.snapshot);
  }

  reorderTabs(notes: WorkspaceNote[], input: ReorderWorkspaceTabsInput): WorkspaceTabsSessionSnapshot {
    const expectedIds = new Set(this.snapshot.tabs.map((tab) => tab.id));
    if (input.tabIds.length !== this.snapshot.tabs.length) {
      throw new Error("tabIds must include every open tab exactly once");
    }

    const seen = new Set<string>();
    input.tabIds.forEach((tabId) => {
      if (!expectedIds.has(tabId) || seen.has(tabId)) {
        throw new Error("tabIds must include every open tab exactly once");
      }
      seen.add(tabId);
    });

    const tabsById = new Map(this.snapshot.tabs.map((tab) => [tab.id, tab]));
    this.snapshot.tabs = input.tabIds
      .map((tabId) => tabsById.get(tabId))
      .filter((tab): tab is WorkspaceTab => tab !== undefined);

    this.touch();
    return cloneWorkspaceTabsSessionSnapshot(this.snapshot);
  }

  activateTab(notes: WorkspaceNote[], input: ActivateWorkspaceTabInput): WorkspaceTabsSessionSnapshot {
    const tab = this.snapshot.tabs.find((item) => item.id === input.tabId);
    if (!tab) {
      throw new Error(`Unknown tab: ${input.tabId}`);
    }

    if (this.snapshot.activeTabId !== tab.id) {
      this.snapshot.activeTabId = tab.id;
      this.touch();
    }

    return cloneWorkspaceTabsSessionSnapshot(this.snapshot);
  }

  removeConnection(connectionId: string): WorkspaceTabsSessionSnapshot {
    if (connectionId === this.defaultConnection.id) {
      throw new Error("Default connection cannot be deleted");
    }

    const nextTabs = this.snapshot.tabs.filter((tab) =>
      (tab.connectionId ?? this.defaultConnection.id) !== connectionId
    );
    if (nextTabs.length === this.snapshot.tabs.length) {
      return cloneWorkspaceTabsSessionSnapshot(this.snapshot);
    }

    this.snapshot.tabs = nextTabs;
    if (!this.snapshot.tabs.some((tab) => tab.id === this.snapshot.activeTabId)) {
      this.snapshot.activeTabId = this.snapshot.tabs[0]?.id ?? null;
    }
    this.touch();
    return cloneWorkspaceTabsSessionSnapshot(this.snapshot);
  }

  private syncConnectionNotes(notes: WorkspaceNote[], connectionId: string): void {
    const notesById = new Map(notes.map((note) => [note.id, note]));
    const nextTabs: WorkspaceTab[] = [];
    let changed = false;

    this.snapshot.tabs.forEach((tab) => {
      const tabConnectionId = tab.connectionId ?? this.defaultConnection.id;
      const connection = this.resolveConnection(tabConnectionId);
      if (!connection) {
        changed = true;
        return;
      }

      if (tabConnectionId !== connectionId) {
        if (tab.connectionId !== connection.id || tab.connectionName !== connection.name) {
          changed = true;
          nextTabs.push({
            ...tab,
            connectionId: connection.id,
            connectionName: connection.name,
          });
          return;
        }

        nextTabs.push({
          ...tab,
          connectionId: connection.id,
          connectionName: connection.name,
        });
        return;
      }

      const note = notesById.get(tab.noteId);
      if (!note) {
        changed = true;
        return;
      }

      if (
        tab.title !== note.title
        || tab.folderPath !== note.folderPath
        || tab.connectionId !== connection.id
        || tab.connectionName !== connection.name
      ) {
        changed = true;
        nextTabs.push({
          ...tab,
          title: note.title,
          folderPath: note.folderPath,
          connectionId: connection.id,
          connectionName: connection.name,
        });
        return;
      }

      nextTabs.push({
        ...tab,
        connectionId: connection.id,
        connectionName: connection.name,
      });
    });

    const hasActiveTab = nextTabs.some((tab) => tab.id === this.snapshot.activeTabId);
    const nextActiveTabId = hasActiveTab ? this.snapshot.activeTabId : (nextTabs[0]?.id ?? null);
    if (nextActiveTabId !== this.snapshot.activeTabId) {
      changed = true;
    }

    if (changed) {
      this.snapshot.tabs = nextTabs;
      this.snapshot.activeTabId = nextActiveTabId;
      this.touch();
      return;
    }

    this.snapshot.tabs = nextTabs;
  }

  private getConnection(connectionId: string | undefined): WorkspaceConnection {
    const resolved = this.resolveConnection(connectionId ?? this.defaultConnection.id);
    if (!resolved) {
      throw new Error(`Unknown connection: ${connectionId ?? this.defaultConnection.id}`);
    }

    return resolved;
  }

  private loadSnapshot(): WorkspaceTabsSessionSnapshot {
    const stateFilePath = this.options.stateFilePath;
    if (!stateFilePath || !existsSync(stateFilePath)) {
      return createEmptyWorkspaceTabsSessionSnapshot();
    }

    try {
      const payload = JSON.parse(readFileSync(stateFilePath, "utf8")) as Partial<WorkspaceTabsSessionSnapshot>;
      return normalizeWorkspaceTabsSessionSnapshot(payload, this.defaultConnection.id);
    } catch {
      return createEmptyWorkspaceTabsSessionSnapshot();
    }
  }

  private persistSnapshot(): void {
    const stateFilePath = this.options.stateFilePath;
    if (!stateFilePath) {
      return;
    }

    mkdirSync(path.dirname(stateFilePath), { recursive: true });
    writeFileSync(stateFilePath, JSON.stringify(this.snapshot, null, 2), "utf8");
  }

  private touch(now = this.now()): void {
    this.snapshot.updatedAt = now.toISOString();
    this.persistSnapshot();
  }
}

export class GraphSDK {
  constructor(private readonly wiki = new WikiSDK()) {}

  buildGlobalGraph(notes: WorkspaceNote[], options: GraphBuildOptions = {}): GraphSnapshot {
    const selectedNotes = this.filterNotes(notes, options);
    return this.buildSnapshot(notes, selectedNotes, options);
  }

  buildLocalGraph(
    notes: WorkspaceNote[],
    centerNoteId: string,
    options: LocalGraphOptions = {}
  ): GraphSnapshot {
    const centerNote = notes.find((note) => note.id === centerNoteId);
    if (!centerNote) {
      return emptyGraphSnapshot();
    }

    const depth = Math.max(0, options.depth ?? 1);
    const adjacency = this.buildNoteAdjacency(notes);
    const visited = new Set<string>([centerNote.id]);
    let frontier = new Set<string>([centerNote.id]);

    for (let currentDepth = 0; currentDepth < depth; currentDepth += 1) {
      const nextFrontier = new Set<string>();

      frontier.forEach((noteId) => {
        (adjacency.get(noteId) ?? []).forEach((neighborId) => {
          if (visited.has(neighborId)) {
            return;
          }

          visited.add(neighborId);
          nextFrontier.add(neighborId);
        });
      });

      if (nextFrontier.size === 0) {
        break;
      }

      frontier = nextFrontier;
    }

    const selectedNotes = notes.filter((note) => visited.has(note.id));
    return this.buildSnapshot(notes, selectedNotes, options);
  }

  getBrokenLinks(notes: WorkspaceNote[], options: GraphBuildOptions = {}): GraphBrokenLink[] {
    const selectedNotes = this.filterNotes(notes, options);
    const linkIndex = this.wiki.buildLinkIndex(notes);

    return selectedNotes.flatMap((note) => {
      const occurrencesByLink = new Map<string, number>();

      this.wiki.extractLinks(note.content).forEach((link) => {
        if (this.wiki.resolveLinkTarget(link, linkIndex, note)) {
          return;
        }

        occurrencesByLink.set(link.link, (occurrencesByLink.get(link.link) ?? 0) + 1);
      });

      return [...occurrencesByLink.entries()]
        .map(([linkText, occurrences]) => ({
          sourceNoteId: note.id,
          sourceTitle: note.title,
          sourceFolderPath: note.folderPath,
          linkText,
          occurrences,
        }))
        .sort((left, right) => left.linkText.localeCompare(right.linkText, "en"));
    }).sort((left, right) => {
      const sourceOrder = left.sourceNoteId.localeCompare(right.sourceNoteId, "en");
      if (sourceOrder !== 0) {
        return sourceOrder;
      }

      return left.linkText.localeCompare(right.linkText, "en");
    });
  }

  getOrphans(notes: WorkspaceNote[], options: GraphBuildOptions = {}): WorkspaceNote[] {
    const selectedNotes = this.filterNotes(notes, options);
    const selectedIds = new Set(selectedNotes.map((note) => note.id));
    const noteDegrees = this.buildNoteDegrees(notes, selectedIds);

    return selectedNotes
      .filter((note) => (noteDegrees.get(note.id) ?? 0) === 0)
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
  }

  getNeighbors(notes: WorkspaceNote[], noteId: string, options: GraphBuildOptions = {}): GraphNeighbor[] {
    const centerNote = notes.find((note) => note.id === noteId);
    if (!centerNote) {
      return [];
    }

    const selectedNotes = this.filterNotes(notes, options);
    const selectedIds = new Set(selectedNotes.map((note) => note.id));
    if (!selectedIds.has(centerNote.id)) {
      return [];
    }

    const notesById = new Map(notes.map((note) => [note.id, note]));
    const linkIndex = this.wiki.buildLinkIndex(notes);
    const neighbors = new Map<string, GraphNeighbor>();

    this.wiki.extractLinks(centerNote.content).forEach((link) => {
      const target = this.wiki.resolveLinkTarget(link, linkIndex, centerNote);
      if (!target || !selectedIds.has(target.id)) {
        return;
      }

      const existing = neighbors.get(target.id);
      if (existing) {
        existing.direction = existing.direction === "incoming" ? "both" : existing.direction;
        existing.weight += 1;
        return;
      }

      neighbors.set(target.id, {
        noteId: target.id,
        title: target.title,
        folderPath: target.folderPath,
        direction: "outgoing",
        weight: 1,
      });
    });

    selectedNotes.forEach((note) => {
      if (note.id === centerNote.id) {
        return;
      }

      const incomingWeight = this.wiki.extractLinks(note.content)
        .filter((link) => this.wiki.resolveLinkTarget(link, linkIndex, note)?.id === centerNote.id)
        .length;
      if (incomingWeight === 0) {
        return;
      }

      const existing = neighbors.get(note.id);
      if (existing) {
        existing.direction = existing.direction === "outgoing" ? "both" : existing.direction;
        existing.weight += incomingWeight;
        return;
      }

      const source = notesById.get(note.id);
      if (!source) {
        return;
      }

      neighbors.set(note.id, {
        noteId: source.id,
        title: source.title,
        folderPath: source.folderPath,
        direction: "incoming",
        weight: incomingWeight,
      });
    });

    return [...neighbors.values()].sort((left, right) => left.noteId.localeCompare(right.noteId, "en"));
  }

  getShortestPath(
    notes: WorkspaceNote[],
    fromNoteId: string,
    toNoteId: string,
    options: GraphBuildOptions = {}
  ): GraphPathResult {
    const selectedNotes = this.filterNotes(notes, options);
    const selectedIds = new Set(selectedNotes.map((note) => note.id));
    if (!selectedIds.has(fromNoteId) || !selectedIds.has(toNoteId)) {
      return { found: false, distance: null, nodes: [] };
    }

    if (fromNoteId === toNoteId) {
      const note = selectedNotes.find((item) => item.id === fromNoteId);
      return note
        ? {
            found: true,
            distance: 0,
            nodes: [toGraphPathNode(note)],
          }
        : { found: false, distance: null, nodes: [] };
    }

    const adjacency = this.buildSelectedNoteAdjacency(notes, selectedIds);
    const notesById = new Map(selectedNotes.map((note) => [note.id, note]));
    const queue = [fromNoteId];
    const visited = new Set<string>([fromNoteId]);
    const previous = new Map<string, string | null>([[fromNoteId, null]]);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const neighbors = [...(adjacency.get(current) ?? [])].sort((left, right) => left.localeCompare(right, "en"));
      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) {
          continue;
        }

        visited.add(neighborId);
        previous.set(neighborId, current);

        if (neighborId === toNoteId) {
          const pathIds = reconstructPath(previous, toNoteId);
          return {
            found: true,
            distance: Math.max(0, pathIds.length - 1),
            nodes: pathIds
              .map((noteId) => notesById.get(noteId))
              .filter((note): note is WorkspaceNote => note !== undefined)
              .map(toGraphPathNode),
          };
        }

        queue.push(neighborId);
      }
    }

    return { found: false, distance: null, nodes: [] };
  }

  getClusters(notes: WorkspaceNote[], options: GraphBuildOptions = {}): GraphCluster[] {
    const selectedNotes = this.filterNotes(notes, options);
    const selectedIds = new Set(selectedNotes.map((note) => note.id));
    const adjacency = this.buildSelectedNoteAdjacency(notes, selectedIds);
    const notesById = new Map(selectedNotes.map((note) => [note.id, note]));
    const visited = new Set<string>();
    const clusters: GraphCluster[] = [];

    const sortedNoteIds = [...selectedIds].sort((left, right) => left.localeCompare(right, "en"));
    sortedNoteIds.forEach((startId) => {
      if (visited.has(startId)) {
        return;
      }

      const queue = [startId];
      const component = new Set<string>();

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || visited.has(current)) {
          continue;
        }

        visited.add(current);
        component.add(current);

        const neighbors = [...(adjacency.get(current) ?? [])].sort((left, right) => left.localeCompare(right, "en"));
        neighbors.forEach((neighborId) => {
          if (!visited.has(neighborId)) {
            queue.push(neighborId);
          }
        });
      }

      const componentNotes = [...component]
        .map((noteId) => notesById.get(noteId))
        .filter((note): note is WorkspaceNote => note !== undefined)
        .sort((left, right) => left.id.localeCompare(right.id, "en"));

      const folders = new Set<string>();
      const tags = new Set<string>();
      componentNotes.forEach((note) => {
        if (note.folderPath) {
          folders.add(note.folderPath);
        }
        this.wiki.extractTags(note.content).forEach((tag) => tags.add(tag));
      });

      clusters.push({
        id: `cluster:${componentNotes[0]?.id ?? startId}`,
        size: componentNotes.length,
        noteIds: componentNotes.map((note) => note.id),
        folders: [...folders].sort((left, right) => left.localeCompare(right, "en")),
        tags: [...tags].sort((left, right) => left.localeCompare(right, "en")),
      });
    });

    return clusters.sort((left, right) => {
      const sizeOrder = right.size - left.size;
      if (sizeOrder !== 0) {
        return sizeOrder;
      }

      return left.id.localeCompare(right.id, "en");
    });
  }

  getTopLinkedNotes(
    notes: WorkspaceNote[],
    options: GraphBuildOptions = {},
    limit = 10
  ): GraphRankedNote[] {
    const selectedNotes = this.filterNotes(notes, options);
    const selectedIds = new Set(selectedNotes.map((note) => note.id));
    const adjacency = this.buildSelectedNoteAdjacency(notes, selectedIds);
    const linkStats = this.buildNoteLinkStats(notes, selectedIds);

    return selectedNotes
      .map((note) => this.toRankedNote(note, linkStats, adjacency, linkStats.get(note.id)?.inboundLinks ?? 0))
      .filter((item) => item.score > 0)
      .sort(compareRankedNotes)
      .slice(0, normalizeLimit(limit));
  }

  getHubNotes(
    notes: WorkspaceNote[],
    options: GraphBuildOptions = {},
    limit = 10
  ): GraphRankedNote[] {
    const selectedNotes = this.filterNotes(notes, options);
    const selectedIds = new Set(selectedNotes.map((note) => note.id));
    const adjacency = this.buildSelectedNoteAdjacency(notes, selectedIds);
    const linkStats = this.buildNoteLinkStats(notes, selectedIds);

    return selectedNotes
      .map((note) => {
        const stats = linkStats.get(note.id) ?? { inboundLinks: 0, outboundLinks: 0 };
        const neighborCount = adjacency.get(note.id)?.size ?? 0;
        return this.toRankedNote(note, linkStats, adjacency, neighborCount * 10 + stats.inboundLinks + stats.outboundLinks);
      })
      .filter((item) => item.score > 0)
      .sort(compareRankedNotes)
      .slice(0, normalizeLimit(limit));
  }

  getBridgeNotes(
    notes: WorkspaceNote[],
    options: GraphBuildOptions = {},
    limit = 10
  ): GraphBridgeNote[] {
    const selectedNotes = this.filterNotes(notes, options);
    const selectedIds = new Set(selectedNotes.map((note) => note.id));
    const adjacency = this.buildSelectedNoteAdjacency(notes, selectedIds);
    const linkStats = this.buildNoteLinkStats(notes, selectedIds);

    return selectedNotes
      .map((note) => {
        const disconnectedGroups = this.computeDisconnectedGroupsAfterRemoval(adjacency, note.id);
        const ranked = this.toRankedNote(note, linkStats, adjacency, disconnectedGroups);
        return {
          ...ranked,
          disconnectedGroups,
        };
      })
      .filter((item) => item.disconnectedGroups > 1)
      .sort((left, right) => {
        const scoreOrder = right.disconnectedGroups - left.disconnectedGroups;
        if (scoreOrder !== 0) {
          return scoreOrder;
        }

        return compareRankedNotes(left, right);
      })
      .slice(0, normalizeLimit(limit));
  }

  private buildSnapshot(
    allNotes: WorkspaceNote[],
    selectedNotes: WorkspaceNote[],
    options: GraphBuildOptions
  ): GraphSnapshot {
    const includeTags = options.includeTags ?? true;
    const includeDangling = options.existingFilesOnly ? false : (options.includeDangling ?? true);
    const includeOrphans = options.includeOrphans ?? true;
    const selectedIds = new Set(selectedNotes.map((note) => note.id));
    const linkIndex = this.wiki.buildLinkIndex(allNotes);
    const nodeDrafts = new Map<string, GraphNodeDraft>();
    const edgeDrafts = new Map<string, GraphEdge>();
    const noteDegrees = this.buildNoteDegrees(allNotes, selectedIds);

    selectedNotes.forEach((note) => {
      const isOrphan = (noteDegrees.get(note.id) ?? 0) === 0;
      if (!includeOrphans && isOrphan) {
        return;
      }

      nodeDrafts.set(note.id, {
        id: note.id,
        label: note.title,
        type: "note",
        noteId: note.id,
        folderPath: note.folderPath,
        orphan: isOrphan,
      });
    });

    selectedNotes.forEach((note) => {
      if (!nodeDrafts.has(note.id)) {
        return;
      }

      this.wiki.extractLinks(note.content).forEach((link) => {
        const target = this.wiki.resolveLinkTarget(link, linkIndex, note);
        if (target && selectedIds.has(target.id)) {
          if (!nodeDrafts.has(target.id)) {
            return;
          }
          upsertEdge(edgeDrafts, note.id, target.id, "wikilink");
          return;
        }

        if (!target && includeDangling) {
          const danglingId = `dangling:${link.link.toLowerCase()}`;
          if (!nodeDrafts.has(danglingId)) {
            nodeDrafts.set(danglingId, {
              id: danglingId,
              label: link.link,
              type: "dangling",
              unresolved: true,
            });
          }
          upsertEdge(edgeDrafts, note.id, danglingId, "wikilink");
        }
      });

      if (!includeTags) {
        return;
      }

      this.wiki.extractTags(note.content).forEach((tag) => {
        const tagId = `tag:${tag}`;
        if (!nodeDrafts.has(tagId)) {
          nodeDrafts.set(tagId, {
            id: tagId,
            label: `#${tag}`,
            type: "tag",
            tag,
          });
        }
        upsertEdge(edgeDrafts, note.id, tagId, "tag");
      });
    });

    return finalizeSnapshot(nodeDrafts, [...edgeDrafts.values()]);
  }

  private filterNotes(notes: WorkspaceNote[], options: GraphBuildOptions): WorkspaceNote[] {
    const normalizedTag = options.tag?.trim().toLowerCase();
    const normalizedFolderPath = normalizeFolderPath(options.folderPath);

    return notes.filter((note) => {
      if (normalizedFolderPath && !isNoteInFolderScope(note, normalizedFolderPath)) {
        return false;
      }

      if (normalizedTag) {
        const tags = this.wiki.extractTags(note.content);
        if (!tags.includes(normalizedTag)) {
          return false;
        }
      }

      return true;
    });
  }

  private buildNoteAdjacency(notes: WorkspaceNote[]): Map<string, Set<string>> {
    const linkIndex = this.wiki.buildLinkIndex(notes);
    const adjacency = new Map<string, Set<string>>();

    notes.forEach((note) => {
      if (!adjacency.has(note.id)) {
        adjacency.set(note.id, new Set());
      }

      this.wiki.extractLinks(note.content).forEach((link) => {
        const target = this.wiki.resolveLinkTarget(link, linkIndex, note);
        if (!target) {
          return;
        }

        adjacency.get(note.id)?.add(target.id);
        if (!adjacency.has(target.id)) {
          adjacency.set(target.id, new Set());
        }
        adjacency.get(target.id)?.add(note.id);
      });
    });

    return adjacency;
  }

  private buildSelectedNoteAdjacency(
    notes: WorkspaceNote[],
    selectedIds: Set<string>
  ): Map<string, Set<string>> {
    const adjacency = this.buildNoteAdjacency(notes);
    const filtered = new Map<string, Set<string>>();

    selectedIds.forEach((noteId) => {
      filtered.set(
        noteId,
        new Set(
          [...(adjacency.get(noteId) ?? [])].filter((neighborId) => selectedIds.has(neighborId))
        )
      );
    });

    return filtered;
  }

  private buildNoteLinkStats(
    notes: WorkspaceNote[],
    selectedIds: Set<string>
  ): Map<string, { inboundLinks: number; outboundLinks: number }> {
    const linkIndex = this.wiki.buildLinkIndex(notes);
    const linkStats = new Map<string, { inboundLinks: number; outboundLinks: number }>();

    selectedIds.forEach((noteId) => {
      linkStats.set(noteId, { inboundLinks: 0, outboundLinks: 0 });
    });

    notes.forEach((note) => {
      if (!selectedIds.has(note.id)) {
        return;
      }

      this.wiki.extractLinks(note.content).forEach((link) => {
        const target = this.wiki.resolveLinkTarget(link, linkIndex, note);
        if (!target || !selectedIds.has(target.id)) {
          return;
        }

        const sourceStats = linkStats.get(note.id);
        const targetStats = linkStats.get(target.id);
        if (!sourceStats || !targetStats) {
          return;
        }

        sourceStats.outboundLinks += 1;
        targetStats.inboundLinks += 1;
      });
    });

    return linkStats;
  }

  private toRankedNote(
    note: WorkspaceNote,
    linkStats: Map<string, { inboundLinks: number; outboundLinks: number }>,
    adjacency: Map<string, Set<string>>,
    score: number
  ): GraphRankedNote {
    const stats = linkStats.get(note.id) ?? { inboundLinks: 0, outboundLinks: 0 };
    const neighbors = adjacency.get(note.id) ?? new Set<string>();

    return {
      noteId: note.id,
      title: note.title,
      folderPath: note.folderPath,
      score,
      inboundLinks: stats.inboundLinks,
      outboundLinks: stats.outboundLinks,
      neighborCount: neighbors.size,
      neighborFolderCount: countNeighborFolders(adjacency, note.id, note.folderPath),
    };
  }

  private computeDisconnectedGroupsAfterRemoval(
    adjacency: Map<string, Set<string>>,
    removedNoteId: string
  ): number {
    const neighbors = [...(adjacency.get(removedNoteId) ?? [])];
    if (neighbors.length <= 1) {
      return 0;
    }

    const visited = new Set<string>();
    let groups = 0;

    neighbors.forEach((neighborId) => {
      if (visited.has(neighborId)) {
        return;
      }

      groups += 1;
      const queue = [neighborId];

      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || current === removedNoteId || visited.has(current)) {
          continue;
        }

        visited.add(current);
        (adjacency.get(current) ?? []).forEach((nextId) => {
          if (nextId !== removedNoteId && !visited.has(nextId)) {
            queue.push(nextId);
          }
        });
      }
    });

    return groups;
  }

  private buildNoteDegrees(
    notes: WorkspaceNote[],
    selectedIds: Set<string>
  ): Map<string, number> {
    const linkIndex = this.wiki.buildLinkIndex(notes);
    const noteDegrees = new Map<string, number>();

    selectedIds.forEach((noteId) => {
      noteDegrees.set(noteId, 0);
    });

    notes.forEach((note) => {
      if (!selectedIds.has(note.id)) {
        return;
      }

      this.wiki.extractLinks(note.content).forEach((link) => {
        const target = this.wiki.resolveLinkTarget(link, linkIndex, note);
        if (!target || !selectedIds.has(target.id)) {
          return;
        }

        noteDegrees.set(note.id, (noteDegrees.get(note.id) ?? 0) + 1);
        noteDegrees.set(target.id, (noteDegrees.get(target.id) ?? 0) + 1);
      });
    });

    return noteDegrees;
  }
}

function upsertEdge(
  edgeDrafts: Map<string, GraphEdge>,
  source: string,
  target: string,
  kind: GraphEdgeKind
): void {
  const edgeId = `${kind}:${source}->${target}`;
  const existing = edgeDrafts.get(edgeId);
  if (existing) {
    existing.weight += 1;
    return;
  }

  edgeDrafts.set(edgeId, {
    id: edgeId,
    source,
    target,
    kind,
    weight: 1,
  });
}

function finalizeSnapshot(
  nodeDrafts: Map<string, GraphNodeDraft>,
  edges: GraphEdge[]
): GraphSnapshot {
  if (nodeDrafts.size === 0) {
    return emptyGraphSnapshot();
  }

  const metrics = new Map<string, { degree: number; inDegree: number; outDegree: number }>();
  nodeDrafts.forEach((_node, nodeId) => {
    metrics.set(nodeId, { degree: 0, inDegree: 0, outDegree: 0 });
  });

  edges.forEach((edge) => {
    const source = metrics.get(edge.source);
    const target = metrics.get(edge.target);
    if (!source || !target) {
      return;
    }

    source.degree += edge.weight;
    source.outDegree += edge.weight;
    target.degree += edge.weight;
    target.inDegree += edge.weight;
  });

  const nodes = [...nodeDrafts.values()]
    .map((node) => {
      const nodeMetrics = metrics.get(node.id) ?? { degree: 0, inDegree: 0, outDegree: 0 };
      return {
        ...node,
        ...nodeMetrics,
        size: 1 + nodeMetrics.degree,
      };
    })
    .sort(compareGraphNodes);

  const maxNodeSize = nodes.reduce((max, node) => Math.max(max, node.size), 0);

  return {
    nodes,
    edges: [...edges].sort((left, right) => left.id.localeCompare(right.id, "en")),
    stats: {
      noteCount: nodes.filter((node) => node.type === "note").length,
      tagCount: nodes.filter((node) => node.type === "tag").length,
      danglingCount: nodes.filter((node) => node.type === "dangling").length,
      orphanNoteCount: nodes.filter((node) => node.type === "note" && node.orphan).length,
      edgeCount: edges.length,
      maxNodeSize,
    },
  };
}

function compareGraphNodes(left: GraphNode, right: GraphNode): number {
  const typeOrder = compareNodeType(left.type, right.type);
  if (typeOrder !== 0) {
    return typeOrder;
  }

  return left.label.localeCompare(right.label, "en");
}

function compareNodeType(left: GraphNodeType, right: GraphNodeType): number {
  const order: Record<GraphNodeType, number> = {
    note: 0,
    tag: 1,
    dangling: 2,
  };

  return order[left] - order[right];
}

function emptyGraphSnapshot(): GraphSnapshot {
  return {
    nodes: [],
    edges: [],
    stats: {
      noteCount: 0,
      tagCount: 0,
      danglingCount: 0,
      orphanNoteCount: 0,
      edgeCount: 0,
      maxNodeSize: 0,
    },
  };
}

function toGraphPathNode(note: WorkspaceNote): { noteId: string; title: string; folderPath: string } {
  return {
    noteId: note.id,
    title: note.title,
    folderPath: note.folderPath,
  };
}

function reconstructPath(previous: Map<string, string | null>, targetNoteId: string): string[] {
  const path: string[] = [];
  let current: string | null | undefined = targetNoteId;

  while (current) {
    path.push(current);
    current = previous.get(current);
  }

  return path.reverse();
}

function compareRankedNotes(left: GraphRankedNote, right: GraphRankedNote): number {
  const scoreOrder = right.score - left.score;
  if (scoreOrder !== 0) {
    return scoreOrder;
  }

  const inboundOrder = right.inboundLinks - left.inboundLinks;
  if (inboundOrder !== 0) {
    return inboundOrder;
  }

  return left.noteId.localeCompare(right.noteId, "en");
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 10;
  }

  return Math.max(1, Math.floor(limit));
}

function countNeighborFolders(
  adjacency: Map<string, Set<string>>,
  noteId: string,
  currentFolderPath: string
): number {
  const folders = new Set<string>();

  (adjacency.get(noteId) ?? []).forEach((neighborId) => {
    const folderPath = dirnameOfNoteId(neighborId);
    folders.add(folderPath);
  });

  if (folders.size === 0 && currentFolderPath) {
    return 0;
  }

  return folders.size;
}

function dirnameOfNoteId(noteId: string): string {
  const segments = noteId.split("/");
  segments.pop();
  return segments.join("/");
}

function normalizeFolderPath(folderPath: string | undefined): string {
  return folderPath?.trim().replace(/^\/+|\/+$/g, "") ?? "";
}

function isNoteInFolderScope(note: WorkspaceNote, folderPath: string): boolean {
  return note.folderPath === folderPath || note.folderPath.startsWith(`${folderPath}/`);
}

function createEmptyWorkspaceTabsSessionSnapshot(): WorkspaceTabsSessionSnapshot {
  return {
    tabs: [],
    activeTabId: null,
    activeNoteId: null,
    activeConnectionId: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function normalizeWorkspaceTabsSessionSnapshot(
  snapshot: Partial<WorkspaceTabsSessionSnapshot>,
  defaultConnectionId: string
): WorkspaceTabsSessionSnapshot {
  const tabs = Array.isArray(snapshot.tabs)
    ? snapshot.tabs.filter(isWorkspaceTab).map((tab) => ({
      ...tab,
      connectionId: tab.connectionId ?? defaultConnectionId,
    }))
    : [];

  return {
    tabs,
    activeTabId: typeof snapshot.activeTabId === "string" ? snapshot.activeTabId : null,
    activeNoteId: resolveActiveNoteId({ tabs, activeTabId: typeof snapshot.activeTabId === "string" ? snapshot.activeTabId : null }),
    activeConnectionId: resolveActiveConnectionId({ tabs, activeTabId: typeof snapshot.activeTabId === "string" ? snapshot.activeTabId : null }),
    updatedAt: typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : new Date(0).toISOString(),
  };
}

function cloneWorkspaceTabsSessionSnapshot(
  snapshot: WorkspaceTabsSessionSnapshot
): WorkspaceTabsSessionSnapshot {
  return {
    tabs: snapshot.tabs.map((tab) => ({ ...tab })),
    activeTabId: snapshot.activeTabId,
    activeNoteId: resolveActiveNoteId(snapshot),
    activeConnectionId: resolveActiveConnectionId(snapshot),
    updatedAt: snapshot.updatedAt,
  };
}

function resolveActiveNoteId(snapshot: Pick<WorkspaceTabsSessionSnapshot, "tabs" | "activeTabId">): string | null {
  const activeTab = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
  return activeTab?.noteId ?? null;
}

function resolveActiveConnectionId(snapshot: Pick<WorkspaceTabsSessionSnapshot, "tabs" | "activeTabId">): string | null {
  const activeTab = snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId);
  return activeTab?.connectionId ?? null;
}

function createWorkspaceTabId(
  connectionId: string,
  noteId: string,
  defaultConnectionId: string
): string {
  return connectionId === defaultConnectionId ? noteId : `${connectionId}:${noteId}`;
}

function createUniqueWorkspaceTabId(baseTabId: string, tabs: WorkspaceTab[]): string {
  if (!tabs.some((tab) => tab.id === baseTabId)) {
    return baseTabId;
  }

  let counter = 2;
  let candidate = `${baseTabId}::${counter}`;
  while (tabs.some((tab) => tab.id === candidate)) {
    counter += 1;
    candidate = `${baseTabId}::${counter}`;
  }

  return candidate;
}

function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<WorkspaceTab>;
  return typeof candidate.id === "string"
    && typeof candidate.noteId === "string"
    && typeof candidate.title === "string"
    && typeof candidate.folderPath === "string"
    && typeof candidate.pinned === "boolean";
}
