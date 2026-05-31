import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Env } from '../env';
import type { AgentRef, AgentRole, Team } from '../../interfaces/game';
import { createCodeWordsMcpServer } from '../mcp/server';

export function matchMcpPath(pathname: string): { gameId: string; team: Team; role: AgentRole } | undefined {
  const match = pathname.match(/^\/mcp\/games\/([^/]+)\/(blue|red)\/(spymaster|guesser)$/);
  if (!match) {
    return undefined;
  }
  return {
    gameId: decodeURIComponent(match[1]),
    team: match[2] as Team,
    role: match[3] as AgentRole,
  };
}

export async function handleMcpRoute(
  request: Request,
  env: Env,
  gameId: string,
  agent: AgentRef,
): Promise<Response> {
  const server = createCodeWordsMcpServer(env, gameId, agent);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
