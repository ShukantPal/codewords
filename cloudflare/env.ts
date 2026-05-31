export type Env = {
  ASSETS: Fetcher;
  CODEWORDS_GAME: DurableObjectNamespace;
  CODEWORDS_DEFAULT_GAME_ID?: string;
  CODEWORDS_SIMULATION_TOKEN?: string;
  TALON_NAMESPACE?: string;
  TALON_API_BASE_URL?: string;
  TALON_BOOTSTRAP_DISABLED?: string;
  TALON_JWT_SECRET?: string;
};

export const DEFAULT_GAME_ID = 'main';

export function getDefaultGameId(env: Env): string {
  return env.CODEWORDS_DEFAULT_GAME_ID?.trim() || DEFAULT_GAME_ID;
}

export function getTalonNamespace(env: Env, gameId: string): string {
  const baseNamespace = env.TALON_NAMESPACE?.trim() || 'codewords';
  return `${baseNamespace}:${gameId}`;
}

export function getTalonApiBaseUrl(env: Env): string {
  return env.TALON_API_BASE_URL?.trim() || 'https://talon.shukant.com';
}

export function getGameStub(env: Env, gameId: string): DurableObjectStub {
  return env.CODEWORDS_GAME.get(env.CODEWORDS_GAME.idFromName(gameId));
}
