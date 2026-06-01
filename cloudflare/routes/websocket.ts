import type { Env } from '../env';
import { getArenaStub, getDefaultArenaId, getGameStub } from '../env';

export function matchArenaWebSocketPath(pathname: string): { arenaId: string } | undefined {
  const match = pathname.match(/^\/ws\/arenas\/([^/]+)$/);
  if (!match) {
    return undefined;
  }
  return { arenaId: decodeURIComponent(match[1]) };
}

export function matchArenaGameWebSocketPath(pathname: string): { arenaId: string; gameId: string } | undefined {
  const match = pathname.match(/^\/ws\/arenas\/([^/]+)\/games\/([^/]+)$/);
  if (!match) {
    return undefined;
  }
  return { arenaId: decodeURIComponent(match[1]), gameId: decodeURIComponent(match[2]) };
}

export function matchWebSocketPath(pathname: string): { gameId: string } | undefined {
  const match = pathname.match(/^\/ws\/games\/([^/]+)$/);
  if (!match) {
    return undefined;
  }
  return { gameId: decodeURIComponent(match[1]) };
}

export function handleWebSocketRoute(request: Request, env: Env, gameId: string): Promise<Response> {
  return handleArenaGameWebSocketRoute(request, env, getDefaultArenaId(env), gameId);
}

export function handleArenaWebSocketRoute(request: Request, env: Env, arenaId: string): Promise<Response> {
  return getArenaStub(env, arenaId).fetch(new Request('https://codewords.internal/ws', request));
}

export function handleArenaGameWebSocketRoute(
  request: Request,
  env: Env,
  arenaId: string,
  gameId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const stubUrl = new URL('https://codewords.internal/ws');
  stubUrl.searchParams.set('showKey', url.searchParams.get('showKey') === 'true' ? 'true' : 'false');
  return getGameStub(env, arenaId, gameId).fetch(new Request(stubUrl, request));
}
