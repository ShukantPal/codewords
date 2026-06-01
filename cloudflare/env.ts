export type Env = {
  ASSETS: Fetcher;
  CODEWORDS_ARENA: DurableObjectNamespace;
  CODEWORDS_GAME: DurableObjectNamespace;
  CODEWORDS_DEFAULT_GAME_ID?: string;
  CODEWORDS_DEFAULT_ARENA_ID?: string;
  CODEWORDS_PUBLIC_URL?: string;
  CODEWORDS_SIMULATION_TOKEN?: string;
  TALON_NAMESPACE?: string;
  TALON_API_BASE_URL?: string;
  TALON_BOOTSTRAP_DISABLED?: string;
  TALON_JWT_SECRET?: string;
};

export const DEFAULT_GAME_ID = 'main';
export const DEFAULT_ARENA_ID = 'main';

export function getDefaultArenaId(env: Env): string {
  return env.CODEWORDS_DEFAULT_ARENA_ID?.trim() || DEFAULT_ARENA_ID;
}

export function getDefaultGameId(env: Env): string {
  return env.CODEWORDS_DEFAULT_GAME_ID?.trim() || DEFAULT_GAME_ID;
}

export function getTalonNamespace(env: Env, arenaId: string): string {
  const baseNamespace = env.TALON_NAMESPACE?.trim() || 'codewords';
  return `${baseNamespace}:${arenaId}`;
}

export function getTalonApiBaseUrl(env: Env): string {
  return env.TALON_API_BASE_URL?.trim() || 'https://talon.shukant.com';
}

export function getCodeWordsPublicUrl(env: Env): string {
  return env.CODEWORDS_PUBLIC_URL?.trim() || 'https://codewords.shukant.com';
}

export function getArenaStub(env: Env, arenaId: string): DurableObjectStub {
  return env.CODEWORDS_ARENA.get(env.CODEWORDS_ARENA.idFromName(arenaId));
}

export function gameObjectName(arenaId: string, gameId: string): string {
  return `${arenaId}:${gameId}`;
}

export function parseGameObjectName(name: string): { arenaId: string; gameId: string } {
  const separator = name.indexOf(':');
  if (separator < 0) {
    return { arenaId: DEFAULT_ARENA_ID, gameId: name };
  }
  return {
    arenaId: name.slice(0, separator) || DEFAULT_ARENA_ID,
    gameId: name.slice(separator + 1) || DEFAULT_GAME_ID,
  };
}

export function getGameStub(env: Env, arenaId: string, gameId?: string): DurableObjectStub {
  const objectName = gameId === undefined ? arenaId : gameObjectName(arenaId, gameId);
  return env.CODEWORDS_GAME.get(env.CODEWORDS_GAME.idFromName(objectName));
}
