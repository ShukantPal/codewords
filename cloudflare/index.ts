import type { Env } from './env';
import { getDefaultGameId } from './env';
import { CodeWordsGame } from './durable-object/codewords-game';
import { handleApiAgentRoute, handleApiGameRoute, matchApiAgentPath, matchApiGamePath } from './routes/api';
import { handleHealthCheck } from './routes/health';
import { handleCodeWordsMcpRoute, handleMcpRoute, matchCodeWordsMcpPath, matchMcpPath } from './routes/mcp';
import { handleTalonChannelToken, handleTalonMcpAuthBroker, handleTalonOptions, handleTalonSessionToken, matchTalonChannelPath, matchTalonMcpAuthPath, matchTalonPath } from './routes/talon';
import { handleWebSocketRoute, matchWebSocketPath } from './routes/websocket';

export { CodeWordsGame };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return handleHealthCheck();
    }

    if (url.pathname === '/api/default-game') {
      return Response.json({ gameId: getDefaultGameId(env) });
    }

    const apiMatch = matchApiGamePath(url.pathname);
    if (apiMatch) {
      return handleApiGameRoute(request, env, apiMatch.gameId, apiMatch.action);
    }

    const apiAgentMatch = matchApiAgentPath(url.pathname);
    if (apiAgentMatch) {
      return handleApiAgentRoute(
        request,
        env,
        apiAgentMatch.gameId,
        apiAgentMatch.team,
        apiAgentMatch.role,
        apiAgentMatch.action,
      );
    }

    const wsMatch = matchWebSocketPath(url.pathname);
    if (wsMatch) {
      return handleWebSocketRoute(request, env, wsMatch.gameId);
    }

    const mcpMatch = matchMcpPath(url.pathname);
    if (mcpMatch) {
      return handleMcpRoute(request, env, mcpMatch.gameId, {
        team: mcpMatch.team,
        role: mcpMatch.role,
      });
    }

    if (matchCodeWordsMcpPath(url.pathname)) {
      return handleCodeWordsMcpRoute(request, env);
    }

    const talonMatch = matchTalonPath(url.pathname);
    if (talonMatch) {
      if (request.method === 'OPTIONS') {
        return handleTalonOptions();
      }
      return handleTalonSessionToken(request, env, talonMatch.gameId, talonMatch.team, talonMatch.role);
    }

    if (matchTalonMcpAuthPath(url.pathname)) {
      if (request.method === 'OPTIONS') {
        return handleTalonOptions();
      }
      return handleTalonMcpAuthBroker(request, env);
    }

    const talonChannelMatch = matchTalonChannelPath(url.pathname);
    if (talonChannelMatch) {
      if (request.method === 'OPTIONS') {
        return handleTalonOptions();
      }
      return handleTalonChannelToken(request, env, talonChannelMatch.gameId);
    }

    return env.ASSETS.fetch(request);
  },
};
