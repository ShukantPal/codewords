import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { getGameStub } from '../env';
import type { ArenaGameSummary, ArenaProjection, ArenaWireClientMessage } from '../../interfaces/arena';
import type { AgentSystemPromptSnapshot } from '../../interfaces/agent-prompts';
import { createAgentSystemPromptSnapshot } from '../../interfaces/agent-prompts';
import type { SpectatorProjection, Team } from '../../interfaces/game';
import type { TeamModelConfig } from '../../interfaces/models';
import { ARENA_MODEL_CONFIGS, ARENA_ROUND_GAME_COUNT, modelForTeam } from '../../interfaces/models';
import { arenaProjection } from '../arena/projections';
import { deleteTalonGameChannel } from '../routes/talon';
import { createWebSocketUpgradeResponse, jsonResponse } from './socket-protocol';

const STORAGE_KEY = 'arena-state';

type ArenaStorage = {
  arenaId: string;
  systemPrompts: AgentSystemPromptSnapshot;
  games: Record<string, ArenaGameSummary>;
  updatedAt: number;
};

function makeGameId(prefix: string, usedIds: Set<string>): string {
  const safePrefix = prefix.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-') || 'game';
  const baseId = `${safePrefix}-${Date.now().toString(36)}`;
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${baseId}-${suffix}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
  }
  throw new Error('Unable to allocate a unique game id.');
}

function modelPairForGame(index: number): Record<Team, TeamModelConfig> {
  const pair = modelPairsForRound()[index % ARENA_ROUND_GAME_COUNT] ?? [0, 1];
  const [blueIndex, redIndex] = pair;
  return {
    blue: modelForTeam('blue', ARENA_MODEL_CONFIGS[blueIndex]),
    red: modelForTeam('red', ARENA_MODEL_CONFIGS[redIndex]),
  };
}

function modelPairsForRound(): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let left = 0; left < ARENA_MODEL_CONFIGS.length; left += 1) {
    for (let right = left + 1; right < ARENA_MODEL_CONFIGS.length; right += 1) {
      pairs.push([left, right]);
    }
  }
  return [
    ...pairs,
    ...pairs.map(([blueIndex, redIndex]) => [redIndex, blueIndex] as [number, number]),
  ];
}

function modelPairsForFocusedModel(modelIndex: number): Array<Record<Team, TeamModelConfig>> {
  if (!ARENA_MODEL_CONFIGS[modelIndex]) {
    throw new Error(`Unknown arena model index: ${modelIndex}.`);
  }
  return modelPairsForRound()
    .filter(([blueIndex, redIndex]) => blueIndex === modelIndex || redIndex === modelIndex)
    .map(([blueIndex, redIndex]) => ({
      blue: modelForTeam('blue', ARENA_MODEL_CONFIGS[blueIndex]),
      red: modelForTeam('red', ARENA_MODEL_CONFIGS[redIndex]),
    }));
}

async function callGameReset(
  env: Env,
  arenaId: string,
  gameId: string,
  models?: Record<Team, TeamModelConfig>,
): Promise<SpectatorProjection> {
  const response = await getGameStub(env, arenaId, gameId).fetch('https://codewords.internal/control', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-codewords-skip-arena-notify': 'true',
      'x-codewords-skip-talon-trigger': 'true',
    },
    body: JSON.stringify({
      type: 'reset-game',
      models,
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
      const stored = await this.ctx.storage.get<Partial<ArenaStorage>>(STORAGE_KEY);
      this.stateData = {
        arenaId,
        games: stored?.games ?? {},
        systemPrompts: stored?.systemPrompts ?? createAgentSystemPromptSnapshot(),
        updatedAt: stored?.updatedAt ?? Date.now(),
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
    return arenaProjection(
      this.state.arenaId,
      Object.values(this.state.games),
      this.state.updatedAt,
      this.state.systemPrompts,
    );
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

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('upgrade') !== 'websocket') {
        return new Response('Expected websocket upgrade', { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'arena-update', payload: this.projection() }));
      return createWebSocketUpgradeResponse(client);
    }

    if (url.pathname === '/snapshot' && request.method === 'GET') {
      return jsonResponse(this.projection());
    }

    if (url.pathname === '/games' && request.method === 'POST') {
      const body = request.body ? await request.json<{ count?: number; prefix?: string; focusModelIndex?: number }>() : {};
      const count = Math.min(Math.max(Number(body.count ?? ARENA_ROUND_GAME_COUNT) || 1, 1), 20);
      const prefix = body.prefix ?? 'game';
      const focusedPairs = Number.isInteger(body.focusModelIndex)
        ? modelPairsForFocusedModel(Number(body.focusModelIndex))
        : undefined;
      const gameModels = focusedPairs ?? Array.from(
        { length: count },
        (_, index) => modelPairForGame(Object.keys(this.state.games).length + index),
      );
      const created: ArenaGameSummary[] = [];
      const usedIds = new Set(Object.keys(this.state.games));
      for (const models of gameModels) {
        const gameId = makeGameId(prefix, usedIds);
        const snapshot = await callGameReset(this.env, this.state.arenaId, gameId, models);
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
      const triggers = created.map((summary) => ({
        gameId: summary.gameId,
        ok: true,
        scheduled: true,
      }));
      return jsonResponse({ arena: this.projection(), games: created, triggers });
    }

    const gameDeleteMatch = url.pathname.match(/^\/games\/([^/]+)$/);
    if (gameDeleteMatch && request.method === 'DELETE') {
      const gameId = decodeURIComponent(gameDeleteMatch[1]);
      const summary = this.state.games[gameId];
      if (!summary) {
        return jsonResponse({ arena: this.projection(), deleted: false, gameId });
      }
      const games = { ...this.state.games };
      delete games[gameId];
      this.stateData = {
        ...this.state,
        games,
        updatedAt: Date.now(),
      };
      await this.persist();
      this.ctx.waitUntil(deleteTalonGameChannel(this.env, this.state.arenaId, gameId, summary.models));
      this.broadcast();
      return jsonResponse({ arena: this.projection(), deleted: true, gameId });
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
