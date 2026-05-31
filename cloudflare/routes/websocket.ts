import type { Env } from '../env';
import { getGameStub } from '../env';

export function matchWebSocketPath(pathname: string): { gameId: string } | undefined {
  const match = pathname.match(/^\/ws\/games\/([^/]+)$/);
  if (!match) {
    return undefined;
  }
  return { gameId: decodeURIComponent(match[1]) };
}

export function handleWebSocketRoute(request: Request, env: Env, gameId: string): Promise<Response> {
  const url = new URL(request.url);
  const stubUrl = new URL('https://codewords.internal/ws');
  stubUrl.searchParams.set('showKey', url.searchParams.get('showKey') === 'true' ? 'true' : 'false');
  return getGameStub(env, gameId).fetch(new Request(stubUrl, request));
}
