import type { GameState } from '../../interfaces/game';
import { createInitialGameState } from '../game/rules';

const STORAGE_KEY = 'game-state';

export async function loadGameState(ctx: DurableObjectState, gameId: string): Promise<GameState> {
  const persisted = await ctx.storage.get<GameState>(STORAGE_KEY);
  return persisted ?? createInitialGameState(gameId);
}

export async function persistGameState(ctx: DurableObjectState, state: GameState): Promise<void> {
  await ctx.storage.put(STORAGE_KEY, state);
}
