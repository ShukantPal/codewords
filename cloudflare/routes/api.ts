import type { Env } from '../env';
import { getGameStub } from '../env';
import type { InternalCommand } from '../../interfaces/commands';
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
