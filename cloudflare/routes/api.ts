import type { Env } from '../env';
import { getGameStub } from '../env';
import type { InternalCommand } from '../../interfaces/commands';
import type { AgentRole, Team } from '../../interfaces/game';
import { jsonResponse } from '../durable-object/socket-protocol';

export function matchApiGamePath(pathname: string): { gameId: string; action?: 'reset' } | undefined {
  const match = pathname.match(/^\/api\/games\/([^/]+)(?:\/(reset))?$/);
  if (!match) {
    return undefined;
  }
  return {
    gameId: decodeURIComponent(match[1]),
    action: match[2] === 'reset' ? 'reset' : undefined,
  };
}

export function matchApiAgentPath(
  pathname: string,
): { gameId: string; team: Team; role: AgentRole; action?: 'clue' | 'guess' | 'pass' | 'messages' } | undefined {
  const match = pathname.match(/^\/api\/games\/([^/]+)\/agents\/(blue|red)\/(spymaster|guesser)(?:\/(clue|guess|pass|messages))?$/);
  if (!match) {
    return undefined;
  }
  return {
    gameId: decodeURIComponent(match[1]),
    team: match[2] as Team,
    role: match[3] as AgentRole,
    action: match[4] as 'clue' | 'guess' | 'pass' | 'messages' | undefined,
  };
}

async function callGame<T>(env: Env, gameId: string, command: InternalCommand): Promise<T> {
  const response = await getGameStub(env, gameId).fetch('https://codewords.internal/control', {
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
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
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

export async function handleApiGameRoute(request: Request, env: Env, gameId: string, action?: 'reset') {
  const url = new URL(request.url);

  if (!action && request.method === 'GET') {
    return jsonResponse(await callGame(env, gameId, {
      type: 'get-state',
      projection: {
        type: 'spectator',
        showKey: url.searchParams.get('showKey') === 'true',
      },
    }));
  }

  if (action === 'reset' && request.method === 'POST') {
    return jsonResponse(await callGame(env, gameId, { type: 'reset-game' }));
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
) {
  if (!isSimulationRequest(request, env)) {
    return new Response('Simulation routes are not enabled.', { status: 403 });
  }

  const agent = { team, role };

  try {
    if (!action && request.method === 'GET') {
      return jsonResponse(await callGame(env, gameId, {
        type: 'get-state',
        projection: { type: 'agent', agent },
      }));
    }

    if (action === 'clue' && request.method === 'POST') {
      const payload = await readJsonPayload(request);
      return jsonResponse(await callGame(env, gameId, {
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
      return jsonResponse(await callGame(env, gameId, {
        type: 'make-guess',
        agent,
        payload: {
          cardId: typeof payload.cardId === 'string' ? payload.cardId : undefined,
          word: typeof payload.word === 'string' ? payload.word : undefined,
        },
      }));
    }

    if (action === 'pass' && request.method === 'POST') {
      return jsonResponse(await callGame(env, gameId, {
        type: 'pass-turn',
        agent,
      }));
    }

    if (action === 'messages' && request.method === 'GET') {
      return jsonResponse(await callGame(env, gameId, {
        type: 'read-protocol-messages',
        agent,
      }));
    }

    if (action === 'messages' && request.method === 'POST') {
      const payload = await readJsonPayload(request);
      return jsonResponse(await callGame(env, gameId, {
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
