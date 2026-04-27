import { WorkspaceTabsSessionStore, type GraphSDK } from "../graph/graph-sdk.js";
import type {
  AgentAccessPolicy,
  AgentBacklinkSummary,
  AgentBacklinksResult,
  AgentCapabilitiesSnapshot,
  AgentConnectionsSnapshot,
  AgentContextConnectionSummary,
  AgentContextPackInput,
  AgentContextPackResult,
  AgentCreateNoteInput,
  AgentGetBacklinksInput,
  AgentGraphSummary,
  AgentGraphSummaryInput,
  AgentNoteSummary,
  AgentOpenTabInput,
  AgentReadNoteInput,
  AgentReadNoteResult,
  AgentSearchNotesInput,
  AgentSearchNotesResult,
  AgentSessionSnapshot,
  AgentToolDescriptor,
  AgentUpdateNoteInput,
  AgentWriteNoteResult,
} from "./types.js";
import { WorkspaceConnectionsStore } from "../workspace/connections-store.js";
import type { WorkspaceConnection, WorkspaceNoteRef } from "../workspace/session-types.js";
import type { WorkspaceNote } from "../workspace/types.js";
import { WorkspaceSDK } from "../workspace/workspace-sdk.js";
import { matchesNoteQuery } from "../wiki/query.js";
import { WikiSDK } from "../wiki/wiki-sdk.js";

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const AGENT_NOTE_WRITE_DISABLED_ERROR = "Agent note writes are disabled by policy";
const BOOTSTRAP_NOTE_PRIORITIES = [
  "AGENTS.md",
  "README.md",
  "CLAUDE.md",
  "agents_md/FRAMEWORK.md",
  "agents_md/shared/COLLABORATION.md",
  "agents_md/shared/SESSIONS.md",
  "hybrid/README.md",
  "hybrid/context/DECISIONS.md",
];

const AGENT_TOOLS: AgentToolDescriptor[] = [
  {
    name: "connections.list",
    method: "GET",
    path: "/api/agent/connections",
    description: "List available workspace connections and the default connection.",
  },
  {
    name: "notes.search",
    method: "GET",
    path: "/api/agent/notes",
    description: "Search notes in a connection by plain text or #tag query.",
  },
  {
    name: "notes.read",
    method: "POST",
    path: "/api/agent/notes/read",
    description: "Read a note by WorkspaceNoteRef with metadata and connection context.",
  },
  {
    name: "notes.create",
    method: "POST",
    path: "/api/agent/notes/create",
    description: "Create a markdown note inside the selected connection notes root.",
  },
  {
    name: "notes.update",
    method: "POST",
    path: "/api/agent/notes/update",
    description: "Update or move a markdown note by WorkspaceNoteRef.",
  },
  {
    name: "notes.backlinks",
    method: "GET",
    path: "/api/agent/backlinks",
    description: "List notes that link to a target note.",
  },
  {
    name: "graph.summary",
    method: "GET",
    path: "/api/agent/graph/summary",
    description: "Return graph statistics for a connection.",
  },
  {
    name: "session.get",
    method: "GET",
    path: "/api/agent/session",
    description: "Return the current workspace tabs/session snapshot.",
  },
  {
    name: "tabs.open",
    method: "POST",
    path: "/api/agent/tabs/open",
    description: "Open a note in the workspace tab session.",
  },
  {
    name: "context.pack",
    method: "POST",
    path: "/api/agent/context",
    description: "Build an aggregated cross-connection context pack for an external agent.",
  },
];

type AgentWorkspaceSDKOptions = {
  workspace: WorkspaceSDK;
  wiki: WikiSDK;
  graph: GraphSDK;
  connections: WorkspaceConnectionsStore;
  tabsSession: WorkspaceTabsSessionStore;
  policy?: Partial<AgentAccessPolicy>;
};

export class AgentWorkspaceSDK {
  private readonly policy: AgentAccessPolicy;

  constructor(private readonly options: AgentWorkspaceSDKOptions) {
    this.policy = {
      allowNoteWrites: options.policy?.allowNoteWrites === true,
    };
  }

  getCapabilities(): AgentCapabilitiesSnapshot {
    return {
      apiVersion: "v0",
      defaultConnectionId: this.options.connections.getDefaultConnection().id,
      tools: this.listTools(),
    };
  }

  listTools(): AgentToolDescriptor[] {
    return AGENT_TOOLS
      .filter((tool) => this.isToolAllowed(tool.name))
      .map((tool) => ({ ...tool }));
  }

  listConnections(): AgentConnectionsSnapshot {
    return {
      defaultConnectionId: this.options.connections.getDefaultConnection().id,
      connections: this.options.connections.listConnections(),
    };
  }

  async searchNotes(input: AgentSearchNotesInput = {}): Promise<AgentSearchNotesResult> {
    const connection = this.getConnection(input.connectionId);
    const query = input.query?.trim() ?? "";
    const limit = normalizeSearchLimit(input.limit);
    const notes = await this.listConnectionNotes(connection.id);

    const matching = notes
      .map((note) => {
        const metadata = this.options.wiki.getMetadata(note, notes);
        return { note, metadata };
      })
      .filter(({ note, metadata }) => matchesNoteQuery(note, metadata, query))
      .sort((left, right) => left.note.id.localeCompare(right.note.id, "en"));

    return {
      connectionId: connection.id,
      query,
      total: matching.length,
      notes: matching.slice(0, limit).map(({ note, metadata }) =>
        toAgentNoteSummary(connection, note, metadata)
      ),
    };
  }

  async readNote(input: AgentReadNoteInput): Promise<AgentReadNoteResult> {
    const connection = this.getConnection(input.noteRef.connectionId);
    const notes = await this.listConnectionNotes(connection.id);
    const note = findNoteOrThrow(notes, input.noteRef);

    return {
      connection,
      noteRef: { connectionId: connection.id, noteId: note.id },
      note,
      metadata: this.options.wiki.getMetadata(note, notes),
    };
  }

  async createNote(input: AgentCreateNoteInput): Promise<AgentWriteNoteResult> {
    this.assertNoteWritesAllowed();
    const connection = this.getConnection(input.connectionId);
    const note = await this.options.workspace.createNote(
      {
        title: input.title,
        content: input.content,
        folderPath: input.folderPath,
      },
      { connectionId: connection.id }
    );

    return {
      connection,
      noteRef: { connectionId: connection.id, noteId: note.id },
      note,
    };
  }

  async updateNote(input: AgentUpdateNoteInput): Promise<AgentWriteNoteResult> {
    this.assertNoteWritesAllowed();
    const connection = this.getConnection(input.noteRef.connectionId);
    const note = await this.options.workspace.updateNote(
      input.noteRef.noteId,
      {
        title: input.title,
        content: input.content,
        folderPath: input.folderPath,
      },
      { connectionId: connection.id }
    );

    return {
      connection,
      noteRef: { connectionId: connection.id, noteId: note.id },
      note,
    };
  }

  async getBacklinks(input: AgentGetBacklinksInput): Promise<AgentBacklinksResult> {
    const connection = this.getConnection(input.noteRef.connectionId);
    const notes = await this.listConnectionNotes(connection.id);
    const note = findNoteOrThrow(notes, input.noteRef);
    const backlinks = this.options.wiki.getBacklinks(note, notes)
      .sort((left, right) => left.id.localeCompare(right.id, "en"))
      .map((item) => toAgentBacklinkSummary(connection.id, item));

    return {
      connection,
      noteRef: { connectionId: connection.id, noteId: note.id },
      backlinks,
    };
  }

  async getGraphSummary(input: AgentGraphSummaryInput = {}): Promise<AgentGraphSummary> {
    const connection = this.getConnection(input.connectionId);
    const notes = await this.listConnectionNotes(connection.id);
    const snapshot = this.options.graph.buildGlobalGraph(notes);

    return {
      connection,
      stats: snapshot.stats,
    };
  }

  async getSession(connectionId?: string): Promise<AgentSessionSnapshot> {
    const connection = this.getConnection(connectionId);
    const notes = await this.listConnectionNotes(connection.id);
    return {
      connection,
      session: this.options.tabsSession.getSnapshot(notes, connection.id),
    };
  }

  async openTab(input: AgentOpenTabInput): Promise<AgentSessionSnapshot> {
    const connection = this.getConnection(input.noteRef.connectionId);
    const notes = await this.listConnectionNotes(connection.id);
    return {
      connection,
      session: this.options.tabsSession.openNote(notes, {
        noteId: input.noteRef.noteId,
        connectionId: connection.id,
        activate: input.activate,
        pinned: input.pinned,
      }),
    };
  }

  async getContextPack(input: AgentContextPackInput = {}): Promise<AgentContextPackResult> {
    const query = input.query?.trim() ?? "";
    const limit = normalizeSearchLimit(input.limit);
    const connections = this.getConnectionsForContext(input.connectionIds);
    const defaultConnectionId = this.options.connections.getDefaultConnection().id;

    const connectionData = await Promise.all(connections.map(async (connection) => {
      const notes = await this.listConnectionNotes(connection.id);
      const matching = notes
        .map((note) => {
          const metadata = this.options.wiki.getMetadata(note, notes);
          return { note, metadata };
        })
        .filter(({ note, metadata }) => query ? matchesNoteQuery(note, metadata, query) : true);
      const graphStats = this.options.graph.buildGlobalGraph(notes).stats;
      const session = this.options.tabsSession.getSnapshot(notes, connection.id);
      const connectionTabs = session.tabs.filter((tab) =>
        tab.noteId && (tab.connectionId ?? defaultConnectionId) === connection.id
      );
      const activeConnectionTab = connectionTabs.find((tab) => tab.id === session.activeTabId) ?? null;

      return {
        connection,
        notes,
        matching,
        summary: {
          connection,
          noteCount: notes.length,
          matchCount: matching.length,
          graphStats,
          session: {
            openTabCount: connectionTabs.length,
            activeTabId: activeConnectionTab?.id ?? null,
            activeNoteId: activeConnectionTab?.noteId ?? null,
          },
        } satisfies AgentContextConnectionSummary,
      };
    }));

    return {
      query,
      totalMatches: connectionData.reduce((total, item) => total + item.matching.length, 0),
      connections: connectionData
        .map((item) => item.summary)
        .sort((left, right) => left.connection.id.localeCompare(right.connection.id, "en")),
      bootstrapNotes: connectionData
        .flatMap(({ connection, notes }) => getBootstrapNotes(connection, notes, this.options.wiki))
        .sort(compareBootstrapNotes),
      notes: connectionData
        .flatMap(({ connection, matching }) =>
          matching.map(({ note, metadata }) => toAgentNoteSummary(connection, note, metadata))
        )
        .sort(compareAgentNoteSummaryByUpdatedAtDesc)
        .slice(0, limit),
    };
  }

  private getConnection(connectionId?: string): WorkspaceConnection {
    const effectiveId = connectionId?.trim() || this.options.connections.getDefaultConnection().id;
    const connection = this.options.connections.getConnection(effectiveId);
    if (!connection) {
      throw new Error(`Unknown connection: ${effectiveId}`);
    }

    return connection;
  }

  private listConnectionNotes(connectionId: string): Promise<WorkspaceNote[]> {
    return this.options.workspace.listNotes({ connectionId });
  }

  private getConnectionsForContext(connectionIds: string[] | undefined): WorkspaceConnection[] {
    if (!connectionIds || connectionIds.length === 0) {
      return this.options.connections.listConnections();
    }

    const uniqueIds = [...new Set(connectionIds.map((value) => value.trim()).filter(Boolean))];
    return uniqueIds.map((connectionId) => this.getConnection(connectionId));
  }

  isToolAllowed(toolName: string): boolean {
    if (!this.hasTool(toolName)) {
      return false;
    }

    if ((toolName === "notes.create" || toolName === "notes.update") && !this.getPolicy().allowNoteWrites) {
      return false;
    }

    return true;
  }

  hasTool(toolName: string): boolean {
    return AGENT_TOOLS.some((tool) => tool.name === toolName);
  }

  getPolicy(): AgentAccessPolicy {
    return { ...this.policy };
  }

  private assertNoteWritesAllowed(): void {
    if (!this.getPolicy().allowNoteWrites) {
      throw new Error(AGENT_NOTE_WRITE_DISABLED_ERROR);
    }
  }
}

export { AGENT_NOTE_WRITE_DISABLED_ERROR };

function normalizeSearchLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SEARCH_LIMIT;
  }

  if (!Number.isFinite(value) || value < 1) {
    throw new Error("limit must be a positive integer");
  }

  return Math.min(Math.floor(value), MAX_SEARCH_LIMIT);
}

function findNoteOrThrow(notes: WorkspaceNote[], noteRef: WorkspaceNoteRef): WorkspaceNote {
  const note = notes.find((item) => item.id === noteRef.noteId);
  if (!note) {
    throw new Error(`Unknown note: ${noteRef.noteId}`);
  }

  return note;
}

function toAgentNoteSummary(
  connection: WorkspaceConnection,
  note: WorkspaceNote,
  metadata: ReturnType<WikiSDK["getMetadata"]>
): AgentNoteSummary {
  return {
    noteRef: {
      connectionId: connection.id,
      noteId: note.id,
    },
    connectionName: connection.name,
    title: note.title,
    folderPath: note.folderPath,
    excerpt: createExcerpt(note.content),
    tags: [...metadata.tags],
    linksCount: metadata.links.length,
    backlinksCount: metadata.backlinks.length,
    updatedAt: note.updatedAt,
  };
}

function toAgentBacklinkSummary(connectionId: string, note: WorkspaceNote): AgentBacklinkSummary {
  return {
    noteRef: {
      connectionId,
      noteId: note.id,
    },
    title: note.title,
    folderPath: note.folderPath,
    updatedAt: note.updatedAt,
  };
}

function getBootstrapNotes(
  connection: WorkspaceConnection,
  notes: WorkspaceNote[],
  wiki: WikiSDK
): AgentNoteSummary[] {
  const notesById = new Map(notes.map((note) => [normalizeNoteId(note.id), note]));
  return BOOTSTRAP_NOTE_PRIORITIES
    .map((noteId) => notesById.get(normalizeNoteId(noteId)) ?? null)
    .filter((note): note is WorkspaceNote => note !== null)
    .map((note) => toAgentNoteSummary(connection, note, wiki.getMetadata(note, notes)));
}

function normalizeNoteId(noteId: string): string {
  return noteId.replaceAll("\\", "/").toLowerCase();
}

function compareBootstrapNotes(left: AgentNoteSummary, right: AgentNoteSummary): number {
  const byConnection = left.noteRef.connectionId.localeCompare(right.noteRef.connectionId, "en");
  if (byConnection !== 0) {
    return byConnection;
  }

  return getBootstrapPriority(left.noteRef.noteId) - getBootstrapPriority(right.noteRef.noteId)
    || left.noteRef.noteId.localeCompare(right.noteRef.noteId, "en");
}

function getBootstrapPriority(noteId: string): number {
  const normalized = normalizeNoteId(noteId);
  const index = BOOTSTRAP_NOTE_PRIORITIES
    .map((item) => normalizeNoteId(item))
    .indexOf(normalized);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function createExcerpt(content: string): string {
  const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  const normalized = withoutFrontmatter.replace(/\s+/g, " ").trim();
  if (normalized.length <= 160) {
    return normalized;
  }

  return `${normalized.slice(0, 157).trimEnd()}...`;
}

function compareAgentNoteSummaryByUpdatedAtDesc(left: AgentNoteSummary, right: AgentNoteSummary): number {
  const byTime = right.updatedAt.localeCompare(left.updatedAt, "en");
  if (byTime !== 0) {
    return byTime;
  }

  const byConnection = left.noteRef.connectionId.localeCompare(right.noteRef.connectionId, "en");
  if (byConnection !== 0) {
    return byConnection;
  }

  return left.noteRef.noteId.localeCompare(right.noteRef.noteId, "en");
}
