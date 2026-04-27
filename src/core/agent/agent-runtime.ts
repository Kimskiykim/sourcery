import type {
  AgentBacklinksResult,
  AgentCapabilitiesSnapshot,
  AgentConnectionsSnapshot,
  AgentContextPackInput,
  AgentContextPackResult,
  AgentCreateNoteInput,
  AgentGetBacklinksInput,
  AgentGraphSummary,
  AgentGraphSummaryInput,
  AgentOpenTabInput,
  AgentReadNoteInput,
  AgentReadNoteResult,
  AgentSearchNotesInput,
  AgentSearchNotesResult,
  AgentSessionSnapshot,
  AgentUpdateNoteInput,
  AgentWriteNoteResult,
} from "./types.js";

export interface AgentRuntime {
  getCapabilities(): AgentCapabilitiesSnapshot;
  hasTool(toolName: string): boolean;
  isToolAllowed(toolName: string): boolean;
  listConnections(): AgentConnectionsSnapshot | Promise<AgentConnectionsSnapshot>;
  searchNotes(input?: AgentSearchNotesInput): Promise<AgentSearchNotesResult>;
  readNote(input: AgentReadNoteInput): Promise<AgentReadNoteResult>;
  createNote(input: AgentCreateNoteInput): Promise<AgentWriteNoteResult>;
  updateNote(input: AgentUpdateNoteInput): Promise<AgentWriteNoteResult>;
  getBacklinks(input: AgentGetBacklinksInput): Promise<AgentBacklinksResult>;
  getGraphSummary(input?: AgentGraphSummaryInput): Promise<AgentGraphSummary>;
  getSession(connectionId?: string): Promise<AgentSessionSnapshot>;
  openTab(input: AgentOpenTabInput): Promise<AgentSessionSnapshot>;
  getContextPack(input?: AgentContextPackInput): Promise<AgentContextPackResult>;
}
