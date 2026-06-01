import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { getDefaultGameId, getGameStub } from '../env';
import type { ArenaGameSummary, ArenaProjection, ArenaWireClientMessage } from '../../interfaces/arena';
import type { SpectatorProjection } from '../../interfaces/game';
import { arenaProjection } from '../arena/projections';
import { createWebSocketUpgradeResponse, jsonResponse } from './socket-protocol';

const STORAGE_KEY = 'arena-state';

type ArenaStorage = {
  arenaId: string;
  games: Record<string, ArenaGameSummary>;
  updatedAt: number;
};

function makeGameId(prefix: string): string {
  const safePrefix = prefix.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-') || 'game';
  return `${safePrefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
}

async function callGameReset(env: Env, arenaId: string, gameId: string): Promise<SpectatorProjection> {
  const response = await getGameStub(env, arenaId, gameId).fetch('https://codewords.internal/control', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-codewords-skip-arena-notify': 'true',
    },
    body: JSON.stringify({
      type: 'reset-game',
      projection: { type: 'spectator', showKey: false },
    }),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json<SpectatorProjection>();
}

async function callGameSummary(env: Env, arenaId: string, gameId: string): Promise<ArenaGameSummary> {
  const response = await getGameStub(env, arenaId, gameId).fetch('https://codewords.internal/summary');
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json<ArenaGameSummary>();
}

export class CodeWordsArena extends DurableObject<Env> {
  private stateData?: ArenaStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const arenaId = this.ctx.id.name ?? 'main';
      this.stateData = await this.ctx.storage.get<ArenaStorage>(STORAGE_KEY) ?? {
        arenaId,
        games: {},
        updatedAt: Date.now(),
      };
    });
  }

  private get state(): ArenaStorage {
    if (!this.stateData) {
      throw new Error('Arena state has not been initialized.');
    }
    return this.stateData;
  }

  private projection(): ArenaProjection {
    return arenaProjection(this.state.arenaId, Object.values(this.state.games), this.state.updatedAt);
  }

  private async persist(): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, this.state);
  }

  private broadcast(): void {
    const payload = this.projection();
    const message = JSON.stringify({ type: 'arena-update', payload });
    for (const socket of this.ctx.getWebSockets()) {
      socket.send(message);
    }
  }

  private async upsertGame(summary: ArenaGameSummary): Promise<void> {
    this.stateData = {
      ...this.state,
      games: {
        ...this.state.games,
        [summary.gameId]: summary,
      },
      updatedAt: Date.now(),
    };
    await this.persist();
    this.broadcast();
  }

  private async ensureDefaultGameRegistered(): Promise<void> {
    if (Object.keys(this.state.games).length > 0) {
      return;
    }
    const defaultGameId = getDefaultGameId(this.env);
    const summary = await callGameSummary(this.env, this.state.arenaId, defaultGameId);
    this.stateData = {
      ...this.state,
      games: {
        ...this.state.games,
        [summary.gameId]: summary,
      },
      updatedAt: Date.now(),
    };
    await this.persist();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('upgrade') !== 'websocket') {
        return new Response('Expected websocket upgrade', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      await this.ensureDefaultGameRegistered();
      server.send(JSON.stringify({ type: 'arena-update', payload: this.projection() }));
      return createWebSocketUpgradeResponse(client);
    }

    if (url.pathname === '/snapshot' && request.method === 'GET') {
      await this.ensureDefaultGameRegistered();
      return jsonResponse(this.projection());
    }

    if (url.pathname === '/games' && request.method === 'POST') {
      const body = request.body ? await request.json<{ count?: number; prefix?: string }>() : {};
      const count = Math.min(Math.max(Number(body.count ?? 1) || 1, 1), 20);
      const prefix = body.prefix ?? 'game';
      const created: ArenaGameSummary[] = [];
      for (let index = 0; index < count; index += 1) {
        const gameId = makeGameId(prefix);
        const snapshot = await callGameReset(this.env, this.state.arenaId, gameId);
        const summary = await callGameSummary(this.env, this.state.arenaId, gameId);
        created.push(summary);
        this.state.games[gameId] = summary;
        void snapshot;
      }
      this.stateData = {
        ...this.state,
        updatedAt: Date.now(),
      };
      await this.persist();
      this.broadcast();
      return jsonResponse({ arena: this.projection(), games: created });
    }

    if (url.pathname === '/internal/game-updated' && request.method === 'POST') {
      const summary = await request.json<ArenaGameSummary>();
      await this.upsertGame(summary);
      return jsonResponse({ ok: true });
    }

    return new Response('Not found', { status: 404 });
  }

  webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer): void {
    const text = typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage);
    let message: ArenaWireClientMessage | undefined;
    try {
      message = JSON.parse(text) as ArenaWireClientMessage;
    } catch {
      socket.send(JSON.stringify({ type: 'error', payload: { message: 'Unsupported websocket message.' } }));
      return;
    }
    if (message.type === 'subscribe') {
      socket.send(JSON.stringify({ type: 'arena-update', payload: this.projection() }));
    }
  }
}
