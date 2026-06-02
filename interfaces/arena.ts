import type { AgentRef, GameStatus, ScoreState, Team, TurnState } from './game';
import type { TeamModelConfig } from './models';
import type { AgentSystemPromptSnapshot } from './agent-prompts';

export type ArenaGameMetrics = {
  clues: number;
  clueCountTotal: number;
  guesses: number;
  passes: number;
  illegalMoves: number;
  illegalClues: number;
  illegalGuesses: number;
  correctGuesses: number;
  neutralReveals: number;
  opponentReveals: number;
  assassinReveals: number;
};

export type ArenaTeamMetrics = ArenaGameMetrics;

export type ArenaGameSummary = {
  arenaId: string;
  gameId: string;
  status: GameStatus;
  winner?: Team;
  scores: ScoreState;
  turn: TurnState;
  activeAgent?: AgentRef;
  activeTalonAgent?: string;
  models: Record<Team, TeamModelConfig>;
  metrics: ArenaGameMetrics;
  teamMetrics: Record<Team, ArenaTeamMetrics>;
  createdAt: number;
  updatedAt: number;
};

export type ArenaLeaderboardEntry = {
  modelId: string;
  provider: string;
  model: string;
  teams: Team[];
  games: number;
  finishedGames: number;
  wins: number;
  losses: number;
  winRate: number;
  illegalMoves: number;
  illegalClues: number;
  illegalGuesses: number;
  illegalMovesPerGame: number;
  averageTurnsToFinish: number;
  averageClueSize: number;
  correctGuessRate: number;
  neutralRevealRate: number;
  opponentRevealRate: number;
  assassinLossRate: number;
};

export type ArenaProjection = {
  arenaId: string;
  systemPrompts: AgentSystemPromptSnapshot;
  games: ArenaGameSummary[];
  leaderboard: ArenaLeaderboardEntry[];
  updatedAt: number;
};

export type ArenaWireClientMessage =
  | { type: 'subscribe' };

export type ArenaWireServerMessage =
  | { type: 'arena-update'; payload: ArenaProjection }
  | { type: 'error'; payload: { message: string } };
