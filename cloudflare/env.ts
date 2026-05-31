export type Env = {
  ASSETS: Fetcher;
  CODEWORDS_GAME: DurableObjectNamespace;
  CODEWORDS_DEFAULT_GAME_ID?: string;
  CODEWORDS_SIMULATION_TOKEN?: string;
  TALON_NAMESPACE?: string;
  GATEWAY_JWT_SECRET?: string;
};

export const DEFAULT_GAME_ID = 'global-codewords-showdown';

export function getDefaultGameId(env: Env): string {
  return env.CODEWORDS_DEFAULT_GAME_ID?.trim() || DEFAULT_GAME_ID;
}

export function getTalonNamespace(env: Env): string {
  return env.TALON_NAMESPACE?.trim() || 'codewords';
}

export function getGameStub(env: Env, gameId: string): DurableObjectStub {
  return env.CODEWORDS_GAME.get(env.CODEWORDS_GAME.idFromName(gameId));
}
