import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Env } from '../env';
import { getDefaultArenaId, getTalonNamespace } from '../env';
import type { AgentRef, AgentRole, Team } from '../../interfaces/game';
import { createCodeWordsMcpServer } from '../mcp/server';

export function matchMcpPath(pathname: string): { arenaId: string; gameId?: string; team: Team; role: AgentRole } | undefined {
  const arenaGameMatch = pathname.match(/^\/mcp\/arenas\/([^/]+)\/games\/([^/]+)\/(blue|red)\/(spymaster|guesser)$/);
  if (arenaGameMatch) {
    return {
      arenaId: decodeURIComponent(arenaGameMatch[1]),
      gameId: decodeURIComponent(arenaGameMatch[2]),
      team: arenaGameMatch[3] as Team,
      role: arenaGameMatch[4] as AgentRole,
    };
  }
  const arenaMatch = pathname.match(/^\/mcp\/arenas\/([^/]+)\/(blue|red)\/(spymaster|guesser)$/);
  if (arenaMatch) {
    return {
      arenaId: decodeURIComponent(arenaMatch[1]),
      team: arenaMatch[2] as Team,
      role: arenaMatch[3] as AgentRole,
    };
  }
  const match = pathname.match(/^\/mcp\/games\/([^/]+)\/(blue|red)\/(spymaster|guesser)$/);
  if (!match) {
    return undefined;
  }
  return {
    arenaId: 'main',
    gameId: decodeURIComponent(match[1]),
    team: match[2] as Team,
    role: match[3] as AgentRole,
  };
}

export function matchCodeWordsMcpPath(pathname: string): boolean {
  return pathname === '/mcp/codewords';
}

function base64UrlDecodeToBuffer(value: string): ArrayBuffer {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

async function verifyCodeWordsMcpToken(env: Env, token: string): Promise<Record<string, unknown>> {
  const secret = env.TALON_JWT_SECRET?.trim();
  if (!secret) {
    throw new Error('TALON_JWT_SECRET is not configured.');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Expected a signed JWT.');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const verified = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlDecodeToBuffer(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) {
    throw new Error('Invalid MCP token signature.');
  }

  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBuffer(parts[1]))) as Record<string, unknown>;
  if (claims.aud !== 'codewords-mcp') {
    throw new Error('Invalid MCP token audience.');
  }
  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('MCP token is expired.');
  }
  return claims;
}

export function parseMcpAgentName(agentName: unknown): AgentRef | undefined {
  if (agentName === undefined) {
    return undefined;
  }
  if (typeof agentName !== 'string') {
    throw new Error('MCP token has an invalid talon:agent.');
  }
  const match = agentName.match(/(?:^|.*-)(blue|red)-(spymaster|guesser)$/);
  if (!match) {
    throw new Error(`Unsupported CodeWords agent: ${agentName}`);
  }
  return {
    team: match[1] as Team,
    role: match[2] as AgentRole,
  };
}

function arenaIdFromNamespace(env: Env, namespace: unknown): string {
  if (typeof namespace !== 'string') {
    throw new Error('MCP token is missing talon:ns.');
  }
  const baseNamespace = getTalonNamespace(env, '').replace(/:$/, '');
  const prefix = `${baseNamespace}:`;
  if (!namespace.startsWith(prefix)) {
    throw new Error(`Unsupported CodeWords namespace: ${namespace}`);
  }
  const arenaId = namespace.slice(prefix.length);
  if (!arenaId) {
    throw new Error('MCP token namespace does not include an arena id.');
  }
  return arenaId;
}

export async function handleCodeWordsMcpRoute(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) {
    return new Response('Missing bearer token.', { status: 401 });
  }

  let arenaId: string;
  let agent: AgentRef | undefined;
  let reviewer: string | undefined;
  try {
    const claims = await verifyCodeWordsMcpToken(env, token);
    arenaId = arenaIdFromNamespace(env, claims['talon:ns']);
    if (claims['codewords:reviewer'] === true && typeof claims['talon:agent'] === 'string') {
      reviewer = claims['talon:agent'];
    } else {
      agent = parseMcpAgentName(claims['talon:agent']);
    }
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 401 });
  }

  return handleMcpRoute(request, env, arenaId, undefined, agent, reviewer);
}

export async function handleMcpRoute(
  request: Request,
  env: Env,
  arenaId: string,
  gameId?: string,
  agent?: AgentRef,
  reviewer?: string,
): Promise<Response> {
  const server = createCodeWordsMcpServer(env, arenaId || getDefaultArenaId(env), gameId, agent, reviewer);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
