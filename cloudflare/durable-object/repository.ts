import type { GameState } from '../../interfaces/game';
import { TEAM_MODEL_CONFIGS } from '../../interfaces/models';
import { createInitialGameState } from '../game/rules';

const STORAGE_KEY = 'game-state';

export async function loadGameState(ctx: DurableObjectState, arenaId: string, gameId: string): Promise<GameState> {
  const persisted = await ctx.storage.get<GameState>(STORAGE_KEY);
  if (persisted) {
    return {
      ...persisted,
      arenaId: persisted.arenaId ?? arenaId,
      models: persisted.models ?? TEAM_MODEL_CONFIGS,
    };
  }
  return createInitialGameState(gameId, undefined, arenaId);
}

export async function persistGameState(ctx: DurableObjectState, state: GameState): Promise<void> {
  await ctx.storage.put(STORAGE_KEY, state);
}
