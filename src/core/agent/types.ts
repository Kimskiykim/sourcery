import type { WorkspaceConnection, WorkspaceNoteRef, WorkspaceTabsSessionSnapshot } from "../workspace/session-types.js";
import type { GraphSnapshot } from "../graph/types.js";
import type { WorkspaceNote } from "../workspace/types.js";
import type { WikiMetadata } from "../wiki/wiki-sdk.js";

export interface AgentToolDescriptor {
  name: string;
  method: "GET" | "POST";
  path: string;
  description: string;
}

export interface AgentAccessPolicy {
  allowNoteWrites: boolean;
}

export interface AgentCapabilitiesSnapshot {
  apiVersion: "v0";
  defaultConnectionId: string;
  tools: AgentToolDescriptor[];
}

export interface AgentConnectionsSnapshot {
  defaultConnectionId: string;
  connections: WorkspaceConnection[];
}

export interface AgentSearchNotesInput {
  connectionId?: string;
  query?: string;
  limit?: number;
}

export interface AgentNoteSummary {
  noteRef: WorkspaceNoteRef;
  connectionName?: string;
  title: string;
  folderPath: string;
  excerpt: string;
  tags: string[];
  linksCount: number;
  backlinksCount: number;
  updatedAt: string;
}

export interface AgentSearchNotesResult {
  connectionId: string;
  query: string;
  total: number;
  notes: AgentNoteSummary[];
}

export interface AgentReadNoteInput {
  noteRef: WorkspaceNoteRef;
}

export interface AgentReadNoteResult {
  connection: WorkspaceConnection;
  noteRef: WorkspaceNoteRef;
  note: WorkspaceNote;
  metadata: WikiMetadata;
}

export interface AgentCreateNoteInput {
  connectionId?: string;
  title: string;
  content: string;
  folderPath?: string;
}

export interface AgentUpdateNoteInput {
  noteRef: WorkspaceNoteRef;
  title: string;
  content: string;
  folderPath?: string;
}

export interface AgentWriteNoteResult {
  connection: WorkspaceConnection;
  noteRef: WorkspaceNoteRef;
  note: WorkspaceNote;
}

export interface AgentGetBacklinksInput {
  noteRef: WorkspaceNoteRef;
}

export interface AgentBacklinkSummary {
  noteRef: WorkspaceNoteRef;
  title: string;
  folderPath: string;
  updatedAt: string;
}

export interface AgentBacklinksResult {
  connection: WorkspaceConnection;
  noteRef: WorkspaceNoteRef;
  backlinks: AgentBacklinkSummary[];
}

export interface AgentGraphSummaryInput {
  connectionId?: string;
}

export interface AgentGraphSummary {
  connection: WorkspaceConnection;
  stats: GraphSnapshot["stats"];
}

export interface AgentOpenTabInput {
  noteRef: WorkspaceNoteRef;
  activate?: boolean;
  pinned?: boolean;
}

export interface AgentSessionSnapshot {
  connection: WorkspaceConnection;
  session: WorkspaceTabsSessionSnapshot;
}

export interface AgentContextPackInput {
  query?: string;
  connectionIds?: string[];
  limit?: number;
}

export interface AgentContextConnectionSummary {
  connection: WorkspaceConnection;
  noteCount: number;
  matchCount: number;
  graphStats: GraphSnapshot["stats"];
  session: {
    openTabCount: number;
    activeTabId: string | null;
    activeNoteId: string | null;
  };
}

export interface AgentContextPackResult {
  query: string;
  totalMatches: number;
  connections: AgentContextConnectionSummary[];
  notes: AgentNoteSummary[];
}
