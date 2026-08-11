export interface SseConnection {
  id: string;
  userId: string;
  teamId: string;
}

/**
 * Tracks which open SSE connections (one per browser tab that's the current
 * leader, per ADR 0001) belong to which user/team, so a pub/sub fanout
 * message naming a team + recipient user ids can be turned into "call this
 * connection's catch-up callback" without touching Postgres for connections
 * it doesn't concern. Pure and framework-agnostic on purpose — no Fastify
 * types here — so it's unit-testable without a real HTTP server.
 */
export class SseRegistry {
  private connections = new Map<string, SseConnection & { onFanout: () => void }>();

  add(connection: SseConnection, onFanout: () => void): void {
    this.connections.set(connection.id, { ...connection, onFanout });
  }

  remove(id: string): void {
    this.connections.delete(id);
  }

  dispatch(teamId: string, userIds: string[]): void {
    for (const connection of this.connections.values()) {
      if (connection.teamId === teamId && userIds.includes(connection.userId)) {
        connection.onFanout();
      }
    }
  }

  get size(): number {
    return this.connections.size;
  }
}
