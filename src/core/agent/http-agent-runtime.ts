import type { WorkspaceNoteRef } from "../workspace/session-types.js";
import type { AgentRuntime } from "./agent-runtime.js";
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

export const DEFAULT_SOURCERY_URL = "http://127.0.0.1:4173";

type SourceryHttpAgentRuntimeOptions = {
  baseUrl?: string;
};

type HttpErrorPayload = {
  error?: string;
};

export class SourceryHttpAgentRuntime implements AgentRuntime {
  private constructor(
    private readonly baseUrl: URL,
    private readonly capabilities: AgentCapabilitiesSnapshot
  ) {}

  static async connect(options: SourceryHttpAgentRuntimeOptions = {}): Promise<SourceryHttpAgentRuntime> {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const capabilities = await fetchJson<AgentCapabilitiesSnapshot>(baseUrl, "/api/agent/capabilities");
    return new SourceryHttpAgentRuntime(baseUrl, capabilities);
  }

  getCapabilities(): AgentCapabilitiesSnapshot {
    return {
      ...this.capabilities,
      tools: this.capabilities.tools.map((tool) => ({ ...tool })),
    };
  }

  hasTool(toolName: string): boolean {
    return this.capabilities.tools.some((tool) => tool.name === toolName);
  }

  isToolAllowed(toolName: string): boolean {
    return this.hasTool(toolName);
  }

  listConnections(): Promise<AgentConnectionsSnapshot> {
    return fetchJson(this.baseUrl, "/api/agent/connections");
  }

  searchNotes(input: AgentSearchNotesInput = {}): Promise<AgentSearchNotesResult> {
    return fetchJson(this.baseUrl, "/api/agent/notes", {
      connectionId: input.connectionId,
      query: input.query,
      limit: input.limit,
    });
  }

  readNote(input: AgentReadNoteInput): Promise<AgentReadNoteResult> {
    return postJson(this.baseUrl, "/api/agent/notes/read", input);
  }

  createNote(input: AgentCreateNoteInput): Promise<AgentWriteNoteResult> {
    return postJson(this.baseUrl, "/api/agent/notes/create", input);
  }

  updateNote(input: AgentUpdateNoteInput): Promise<AgentWriteNoteResult> {
    return postJson(this.baseUrl, "/api/agent/notes/update", input);
  }

  getBacklinks(input: AgentGetBacklinksInput): Promise<AgentBacklinksResult> {
    return fetchJson(this.baseUrl, "/api/agent/backlinks", toNoteRefQuery(input.noteRef));
  }

  getGraphSummary(input: AgentGraphSummaryInput = {}): Promise<AgentGraphSummary> {
    return fetchJson(this.baseUrl, "/api/agent/graph/summary", {
      connectionId: input.connectionId,
    });
  }

  getSession(connectionId?: string): Promise<AgentSessionSnapshot> {
    return fetchJson(this.baseUrl, "/api/agent/session", { connectionId });
  }

  openTab(input: AgentOpenTabInput): Promise<AgentSessionSnapshot> {
    return postJson(this.baseUrl, "/api/agent/tabs/open", input);
  }

  getContextPack(input: AgentContextPackInput = {}): Promise<AgentContextPackResult> {
    return postJson(this.baseUrl, "/api/agent/context", input);
  }
}

function normalizeBaseUrl(value: string | undefined): URL {
  const rawValue = value?.trim() || DEFAULT_SOURCERY_URL;
  const parsed = new URL(rawValue);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function toNoteRefQuery(noteRef: WorkspaceNoteRef): Record<string, string> {
  return {
    connectionId: noteRef.connectionId,
    noteId: noteRef.noteId,
  };
}

async function fetchJson<T>(
  baseUrl: URL,
  path: string,
  query: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = buildUrl(baseUrl, path, query);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
  } catch (error) {
    throw createConnectionError(baseUrl, error);
  }

  return readJsonResponse<T>(baseUrl, response);
}

async function postJson<T>(baseUrl: URL, path: string, body: unknown): Promise<T> {
  const url = buildUrl(baseUrl, path);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw createConnectionError(baseUrl, error);
  }

  return readJsonResponse<T>(baseUrl, response);
}

function buildUrl(
  baseUrl: URL,
  path: string,
  query: Record<string, string | number | undefined> = {}
): URL {
  const url = new URL(path, baseUrl);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

async function readJsonResponse<T>(baseUrl: URL, response: Response): Promise<T> {
  const text = await response.text();
  const payload = text.trim() ? JSON.parse(text) as HttpErrorPayload : {};
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : response.statusText;
    throw new Error(`Sourcery HTTP ${response.status}: ${message}`);
  }

  return payload as T;
}

function createConnectionError(baseUrl: URL, error: unknown): Error {
  const cause = error instanceof Error ? ` ${error.message}` : "";
  return new Error(
    `Cannot connect to running Sourcery at ${baseUrl.origin}. Start Sourcery with npm start before launching the agent.${cause}`
  );
}
