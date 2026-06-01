import type { Env } from './env';
import { getDefaultArenaId, getDefaultGameId } from './env';
import { CodeWordsArena } from './durable-object/codewords-arena';
import { CodeWordsGame } from './durable-object/codewords-game';
import { handleApiAgentRoute, handleApiArenaGameRoute, handleApiArenaRoute, handleApiGameRoute, matchApiAgentPath, matchApiArenaGamePath, matchApiArenaPath, matchApiGamePath } from './routes/api';
import { handleHealthCheck } from './routes/health';
import { handleCodeWordsMcpRoute, handleMcpRoute, matchCodeWordsMcpPath, matchMcpPath } from './routes/mcp';
import { handleTalonChannelToken, handleTalonMcpAuthBroker, handleTalonOptions, handleTalonSessionToken, matchTalonChannelPath, matchTalonMcpAuthPath, matchTalonPath } from './routes/talon';
import { handleArenaGameWebSocketRoute, handleArenaWebSocketRoute, handleWebSocketRoute, matchArenaGameWebSocketPath, matchArenaWebSocketPath, matchWebSocketPath } from './routes/websocket';

export { CodeWordsArena, CodeWordsGame };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return handleHealthCheck();
    }

    if (url.pathname === '/api/default-game') {
      return Response.json({ arenaId: getDefaultArenaId(env), gameId: getDefaultGameId(env) });
    }

    const apiArenaGameMatch = matchApiArenaGamePath(url.pathname);
    if (apiArenaGameMatch) {
      return handleApiArenaGameRoute(
        request,
        env,
        apiArenaGameMatch.arenaId,
        apiArenaGameMatch.gameId,
        apiArenaGameMatch.action,
      );
    }

    const apiArenaMatch = matchApiArenaPath(url.pathname);
    if (apiArenaMatch) {
      return handleApiArenaRoute(request, env, apiArenaMatch.arenaId, apiArenaMatch.action);
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
        apiAgentMatch.arenaId ?? getDefaultArenaId(env),
      );
    }

    const arenaWsMatch = matchArenaWebSocketPath(url.pathname);
    if (arenaWsMatch) {
      return handleArenaWebSocketRoute(request, env, arenaWsMatch.arenaId);
    }

    const arenaGameWsMatch = matchArenaGameWebSocketPath(url.pathname);
    if (arenaGameWsMatch) {
      return handleArenaGameWebSocketRoute(request, env, arenaGameWsMatch.arenaId, arenaGameWsMatch.gameId);
    }

    const wsMatch = matchWebSocketPath(url.pathname);
    if (wsMatch) {
      return handleWebSocketRoute(request, env, wsMatch.gameId);
    }

    const mcpMatch = matchMcpPath(url.pathname);
    if (mcpMatch) {
      return handleMcpRoute(request, env, mcpMatch.arenaId, mcpMatch.gameId, {
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
      return handleTalonSessionToken(
        request,
        env,
        talonMatch.arenaId ?? getDefaultArenaId(env),
        talonMatch.gameId,
        talonMatch.team,
        talonMatch.role,
      );
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
      return handleTalonChannelToken(
        request,
        env,
        talonChannelMatch.arenaId ?? getDefaultArenaId(env),
        talonChannelMatch.gameId,
      );
    }

    return env.ASSETS.fetch(request);
  },
};
