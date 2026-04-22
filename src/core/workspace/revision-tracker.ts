export interface WorkspaceConnectionRevisionState {
  connectionId: string;
  revision: number;
  changedAt: string;
}

export interface WorkspaceRevisionState {
  revision: number;
  changedAt: string;
  activeConnectionId?: string | null;
  connections?: WorkspaceConnectionRevisionState[];
}

export class WorkspaceRevisionTracker {
  private revision = 1;
  private changedAt = new Date().toISOString();
  private readonly connectionRevisions = new Map<string, WorkspaceConnectionRevisionState>();

  getState(activeConnectionId?: string | null): WorkspaceRevisionState {
    return {
      revision: this.revision,
      changedAt: this.changedAt,
      activeConnectionId: activeConnectionId ?? null,
      connections: [...this.connectionRevisions.values()]
        .sort((left, right) => left.connectionId.localeCompare(right.connectionId, "en"))
        .map((connection) => ({ ...connection })),
    };
  }

  syncConnections(connectionIds: string[], now = new Date()): WorkspaceRevisionState {
    const normalizedIds = [...new Set(connectionIds.map((connectionId) => connectionId.trim()).filter(Boolean))];
    const nextIds = new Set(normalizedIds);

    normalizedIds.forEach((connectionId) => {
      if (this.connectionRevisions.has(connectionId)) {
        return;
      }

      this.connectionRevisions.set(connectionId, {
        connectionId,
        revision: 1,
        changedAt: now.toISOString(),
      });
    });

    [...this.connectionRevisions.keys()].forEach((connectionId) => {
      if (!nextIds.has(connectionId)) {
        this.connectionRevisions.delete(connectionId);
      }
    });

    return this.getState();
  }

  bump(connectionId?: string | null, now = new Date()): WorkspaceRevisionState {
    this.revision += 1;
    this.changedAt = now.toISOString();

    const normalizedConnectionId = connectionId?.trim();
    if (normalizedConnectionId) {
      const current = this.connectionRevisions.get(normalizedConnectionId);
      this.connectionRevisions.set(normalizedConnectionId, {
        connectionId: normalizedConnectionId,
        revision: (current?.revision ?? 1) + 1,
        changedAt: this.changedAt,
      });
    }

    return this.getState(normalizedConnectionId ?? null);
  }

  forgetConnection(connectionId: string): WorkspaceRevisionState {
    this.connectionRevisions.delete(connectionId);
    return this.getState();
  }
}
