import type { Env } from '../env';
import { getArenaStub, getDefaultArenaId, getGameStub } from '../env';
import type { InternalCommand } from '../../interfaces/commands';
import type { AgentRole, Team } from '../../interfaces/game';
import { jsonResponse } from '../durable-object/socket-protocol';

type GameAction = 'reset' | 'trigger';
type ArenaAction = 'games';

export function matchApiArenaPath(pathname: string): { arenaId: string; action?: ArenaAction } | undefined {
  const match = pathname.match(/^\/api\/arenas\/([^/]+)(?:\/(games))?$/);
  if (!match) {
    return undefined;
  }
  return {
    arenaId: decodeURIComponent(match[1]),
    action: match[2] as ArenaAction | undefined,
  };
}

export function matchApiArenaGamePath(pathname: string): { arenaId: string; gameId: string; action?: GameAction } | undefined {
  const match = pathname.match(/^\/api\/arenas\/([^/]+)\/games\/([^/]+)(?:\/(reset|trigger))?$/);
  if (!match) {
    return undefined;
  }
  return {
    arenaId: decodeURIComponent(match[1]),
    gameId: decodeURIComponent(match[2]),
    action: match[3] as GameAction | undefined,
  };
}

export function matchApiGamePath(pathname: string): { gameId: string; action?: GameAction } | undefined {
  const match = pathname.match(/^\/api\/games\/([^/]+)(?:\/(reset|trigger))?$/);
  if (!match) {
    return undefined;
  }
  return {
    gameId: decodeURIComponent(match[1]),
    action: match[2] as GameAction | undefined,
  };
}

export function matchApiAgentPath(
  pathname: string,
): { arenaId?: string; gameId: string; team: Team; role: AgentRole; action?: 'clue' | 'guess' | 'pass' | 'messages' } | undefined {
  const arenaMatch = pathname.match(/^\/api\/arenas\/([^/]+)\/games\/([^/]+)\/agents\/(blue|red)\/(spymaster|guesser)(?:\/(clue|guess|pass|messages))?$/);
  if (arenaMatch) {
    return {
      arenaId: decodeURIComponent(arenaMatch[1]),
      gameId: decodeURIComponent(arenaMatch[2]),
      team: arenaMatch[3] as Team,
      role: arenaMatch[4] as AgentRole,
      action: arenaMatch[5] as 'clue' | 'guess' | 'pass' | 'messages' | undefined,
    };
  }
  const legacyMatch = pathname.match(/^\/api\/games\/([^/]+)\/agents\/(blue|red)\/(spymaster|guesser)(?:\/(clue|guess|pass|messages))?$/);
  if (!legacyMatch) {
    return undefined;
  }
  return {
    gameId: decodeURIComponent(legacyMatch[1]),
    team: legacyMatch[2] as Team,
    role: legacyMatch[3] as AgentRole,
    action: legacyMatch[4] as 'clue' | 'guess' | 'pass' | 'messages' | undefined,
  };
}

async function callGame<T>(env: Env, arenaId: string, gameId: string, command: InternalCommand): Promise<T> {
  const response = await getGameStub(env, arenaId, gameId).fetch('https://codewords.internal/control', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Game command failed with ${response.status}.`);
  }

  return response.json<T>();
}

function isSimulationRequest(request: Request, env: Env): boolean {
  const url = new URL(request.url);
  const host = request.headers.get('host')?.split(':')[0] ?? '';
  if (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]'
  ) {
    return true;
  }

  const token = env.CODEWORDS_SIMULATION_TOKEN?.trim();
  if (!token) {
    return false;
  }

  return request.headers.get('authorization') === `Bearer ${token}`;
}

async function readJsonPayload(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) {
    return {};
  }
  const parsed = await request.json<unknown>();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object payload.');
  }
  return parsed as Record<string, unknown>;
}

export async function handleApiArenaRoute(request: Request, env: Env, arenaId: string, action?: ArenaAction) {
  if (!action && request.method === 'GET') {
    return getArenaStub(env, arenaId).fetch('https://codewords.internal/snapshot');
  }

  if (action === 'games' && request.method === 'POST') {
    return getArenaStub(env, arenaId).fetch(new Request('https://codewords.internal/games', request));
  }

  return new Response('Method not allowed', { status: 405 });
}

export async function handleApiArenaGameRoute(
  request: Request,
  env: Env,
  arenaId: string,
  gameId: string,
  action?: GameAction,
) {
  if (!action && request.method === 'DELETE') {
    return getArenaStub(env, arenaId).fetch(new Request(
      `https://codewords.internal/games/${encodeURIComponent(gameId)}`,
      request,
    ));
  }

  return handleApiGameRoute(request, env, gameId, action, arenaId);
}

export async function handleApiGameRoute(request: Request, env: Env, gameId: string, action?: GameAction, arenaId = getDefaultArenaId(env)) {
  const url = new URL(request.url);

  if (!action && request.method === 'GET') {
    return jsonResponse(await callGame(env, arenaId, gameId, {
      type: 'get-state',
      projection: {
        type: 'spectator',
        showKey: url.searchParams.get('showKey') === 'true',
      },
    }));
  }

  if (action === 'reset' && request.method === 'POST') {
    return jsonResponse(await callGame(env, arenaId, gameId, { type: 'reset-game' }));
  }

  if (action === 'trigger' && request.method === 'POST') {
    return jsonResponse(await callGame(env, arenaId, gameId, {
      type: 'trigger-current-agent',
      projection: {
        type: 'spectator',
        showKey: url.searchParams.get('showKey') === 'true',
      },
    }));
  }

  return new Response('Method not allowed', { status: 405 });
}

export async function handleApiAgentRoute(
  request: Request,
  env: Env,
  gameId: string,
  team: Team,
  role: AgentRole,
  action?: 'clue' | 'guess' | 'pass' | 'messages',
  arenaId = getDefaultArenaId(env),
) {
  if (!isSimulationRequest(request, env)) {
    return new Response('Simulation routes are not enabled.', { status: 403 });
  }

  const agent = { team, role };

  try {
    if (!action && request.method === 'GET') {
      return jsonResponse(await callGame(env, arenaId, gameId, {
        type: 'get-state',
        projection: { type: 'agent', agent },
      }));
    }

    if (action === 'clue' && request.method === 'POST') {
      const payload = await readJsonPayload(request);
      return jsonResponse(await callGame(env, arenaId, gameId, {
        type: 'give-clue',
        agent,
        payload: {
          word: String(payload.word ?? ''),
          count: Number(payload.count),
        },
      }));
    }

    if (action === 'guess' && request.method === 'POST') {
      const payload = await readJsonPayload(request);
      return jsonResponse(await callGame(env, arenaId, gameId, {
        type: 'make-guess',
        agent,
        payload: {
          cardId: typeof payload.cardId === 'string' ? payload.cardId : undefined,
          word: typeof payload.word === 'string' ? payload.word : undefined,
        },
      }));
    }

    if (action === 'pass' && request.method === 'POST') {
      return jsonResponse(await callGame(env, arenaId, gameId, {
        type: 'pass-turn',
        agent,
      }));
    }

    if (action === 'messages' && request.method === 'GET') {
      return jsonResponse(await callGame(env, arenaId, gameId, {
        type: 'read-protocol-messages',
        agent,
      }));
    }

    if (action === 'messages' && request.method === 'POST') {
      const payload = await readJsonPayload(request);
      return jsonResponse(await callGame(env, arenaId, gameId, {
        type: 'send-protocol-message',
        agent,
        payload: {
          body: String(payload.body ?? ''),
          visibility: payload.visibility === 'team' || payload.visibility === 'role' ? payload.visibility : 'public',
        },
      }));
    }
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  return new Response('Method not allowed', { status: 405 });
}
