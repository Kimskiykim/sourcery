export type GraphNodeType = "note" | "tag" | "dangling";
export type GraphEdgeKind = "wikilink" | "tag";

export interface GraphNode {
  id: string;
  label: string;
  type: GraphNodeType;
  noteId?: string;
  folderPath?: string;
  tag?: string;
  unresolved?: boolean;
  orphan?: boolean;
  degree: number;
  inDegree: number;
  outDegree: number;
  size: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  weight: number;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    noteCount: number;
    tagCount: number;
    danglingCount: number;
    orphanNoteCount: number;
    edgeCount: number;
    maxNodeSize: number;
  };
}

export interface GraphBuildOptions {
  folderPath?: string;
  tag?: string;
  includeTags?: boolean;
  includeDangling?: boolean;
  includeOrphans?: boolean;
  existingFilesOnly?: boolean;
}

export interface LocalGraphOptions extends GraphBuildOptions {
  depth?: number;
}

export interface GraphBrokenLink {
  sourceNoteId: string;
  sourceTitle: string;
  sourceFolderPath: string;
  linkText: string;
  occurrences: number;
}

export interface GraphNeighbor {
  noteId: string;
  title: string;
  folderPath: string;
  direction: "incoming" | "outgoing" | "both";
  weight: number;
}

export interface GraphPathNode {
  noteId: string;
  title: string;
  folderPath: string;
}

export interface GraphPathResult {
  found: boolean;
  distance: number | null;
  nodes: GraphPathNode[];
}

export interface GraphCluster {
  id: string;
  size: number;
  noteIds: string[];
  folders: string[];
  tags: string[];
}

export interface GraphRankedNote {
  noteId: string;
  title: string;
  folderPath: string;
  score: number;
  inboundLinks: number;
  outboundLinks: number;
  neighborCount: number;
  neighborFolderCount: number;
}

export interface GraphBridgeNote extends GraphRankedNote {
  disconnectedGroups: number;
}

export type {
  ActivateWorkspaceTabInput,
  CloseWorkspaceTabInput,
  CreateWorkspaceConnectionInput,
  DeleteWorkspaceFolderByRefInput,
  DeleteWorkspaceNoteByRefInput,
  GetWorkspaceNoteByRefInput,
  OpenWorkspaceTabInput,
  RenameWorkspaceFolderByRefInput,
  ReorderWorkspaceTabsInput,
  SetWorkspaceTabPinnedInput,
  UpdateWorkspaceNoteByRefInput,
  UpdateWorkspaceConnectionInput,
  WorkspaceConnection,
  WorkspaceConnectionKind,
  WorkspaceFolderRef,
  WorkspaceNoteRef,
  WorkspaceTab,
  WorkspaceTabsSessionSnapshot,
} from "../workspace/session-types.js";
