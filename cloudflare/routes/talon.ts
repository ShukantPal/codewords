import type { AgentRole, Team } from '../../interfaces/game';
import type { Env } from '../env';
import { getTalonNamespace } from '../env';
import { jsonResponse } from '../durable-object/socket-protocol';

const TOKEN_TTL_SECONDS = 60 * 15;

export function matchTalonPath(pathname: string): { gameId: string; team: Team; role: AgentRole } | undefined {
  const match = pathname.match(/^\/talon\/games\/([^/]+)\/(blue|red)\/(spymaster|guesser)\/session-token$/);
  if (!match) {
    return undefined;
  }
  return {
    gameId: decodeURIComponent(match[1]),
    team: match[2] as Team,
    role: match[3] as AgentRole,
  };
}

function base64UrlEncode(bytes: ArrayBuffer | string): string {
  const binary = typeof bytes === 'string'
    ? bytes
    : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function mintSessionToken(env: Env, payload: Record<string, unknown>): Promise<string> {
  const secret = env.GATEWAY_JWT_SECRET?.trim();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims = {
    ...payload,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  };

  if (!secret) {
    return base64UrlEncode(JSON.stringify(claims));
  }

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(claims));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${base64UrlEncode(signature)}`;
}

export function handleTalonOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  });
}

export async function handleTalonSessionToken(
  request: Request,
  env: Env,
  gameId: string,
  team: Team,
  role: AgentRole,
): Promise<Response> {
  const url = new URL(request.url);
  const namespace = getTalonNamespace(env);
  const agent = `${team}-${role}`;
  const sessionId = `${gameId}-${agent}`;
  const mcpUrl = new URL(`/mcp/games/${encodeURIComponent(gameId)}/${team}/${role}`, url.origin).toString();
  const token = await mintSessionToken(env, {
    namespace,
    agent,
    sessionId,
    gameId,
    team,
    role,
  });

  return jsonResponse(
    {
      gameId,
      team,
      role,
      token,
      namespace,
      agent,
      sessionId,
      expiresInSeconds: TOKEN_TTL_SECONDS,
      mcpUrl,
    },
    {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    },
  );
}
