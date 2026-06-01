import type {
  ArenaGameMetrics,
  ArenaGameSummary,
  ArenaLeaderboardEntry,
  ArenaProjection,
} from '../../interfaces/arena';
import type { AgentRef, GameEvent, GameState, Team } from '../../interfaces/game';
import { modelId, TEAM_MODEL_CONFIGS } from '../../interfaces/models';

function otherTeam(team: Team): Team {
  return team === 'blue' ? 'red' : 'blue';
}

export function metricsFromEvents(events: GameEvent[]): ArenaGameMetrics {
  const metrics: ArenaGameMetrics = {
    clues: 0,
    guesses: 0,
    passes: 0,
    illegalMoves: 0,
    correctGuesses: 0,
    neutralReveals: 0,
    opponentReveals: 0,
    assassinReveals: 0,
  };

  for (const event of events) {
    if (event.type === 'clue-given') {
      metrics.clues += 1;
    }
    if (event.type === 'turn-passed') {
      metrics.passes += 1;
    }
    if (event.type === 'illegal-move') {
      metrics.illegalMoves += 1;
    }
    if (event.type === 'card-revealed') {
      metrics.guesses += 1;
      if (event.owner === event.team) {
        metrics.correctGuesses += 1;
      } else if (event.owner === 'neutral') {
        metrics.neutralReveals += 1;
      } else if (event.owner === 'assassin') {
        metrics.assassinReveals += 1;
      } else {
        metrics.opponentReveals += 1;
      }
    }
  }

  return metrics;
}

function activeAgentForState(state: GameState): AgentRef | undefined {
  if (state.status !== 'active') {
    return undefined;
  }
  return {
    team: state.turn.team,
    role: state.turn.phase === 'clue' ? 'spymaster' : 'guesser',
  };
}

export function gameSummaryFromState(state: GameState): ArenaGameSummary {
  return {
    arenaId: state.arenaId,
    gameId: state.gameId,
    status: state.status,
    winner: state.winner,
    scores: state.teams,
    turn: state.turn,
    activeAgent: activeAgentForState(state),
    activeTalonAgent: state.activeTalonSession?.agent,
    models: TEAM_MODEL_CONFIGS,
    metrics: metricsFromEvents(state.events),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

function buildLeaderboard(games: ArenaGameSummary[]): ArenaLeaderboardEntry[] {
  const entries = new Map<string, ArenaLeaderboardEntry & {
    totalTurnsToFinish: number;
    totalGuesses: number;
    totalCorrectGuesses: number;
    assassinLosses: number;
  }>();

  for (const game of games) {
    for (const team of ['blue', 'red'] as Team[]) {
      const model = game.models[team];
      const id = modelId(model);
      const entry = entries.get(id) ?? {
        modelId: id,
        provider: model.provider,
        model: model.name,
        teams: [],
        games: 0,
        finishedGames: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        illegalMoves: 0,
        illegalMovesPerGame: 0,
        averageTurnsToFinish: 0,
        correctGuessRate: 0,
        assassinLossRate: 0,
        totalTurnsToFinish: 0,
        totalGuesses: 0,
        totalCorrectGuesses: 0,
        assassinLosses: 0,
      };
      if (!entry.teams.includes(team)) {
        entry.teams.push(team);
      }
      entry.games += 1;
      entry.illegalMoves += game.metrics.illegalMoves;
      entry.totalGuesses += game.metrics.guesses;
      entry.totalCorrectGuesses += game.metrics.correctGuesses;
      if (game.status === 'finished') {
        entry.finishedGames += 1;
        entry.totalTurnsToFinish += game.metrics.clues;
        if (game.winner === team) {
          entry.wins += 1;
        } else {
          entry.losses += 1;
        }
        if (game.winner === otherTeam(team) && game.metrics.assassinReveals > 0) {
          entry.assassinLosses += 1;
        }
      }
      entries.set(id, entry);
    }
  }

  return [...entries.values()]
    .map((entry) => ({
      ...entry,
      winRate: entry.finishedGames > 0 ? entry.wins / entry.finishedGames : 0,
      illegalMovesPerGame: entry.games > 0 ? entry.illegalMoves / entry.games : 0,
      averageTurnsToFinish: entry.finishedGames > 0 ? entry.totalTurnsToFinish / entry.finishedGames : 0,
      correctGuessRate: entry.totalGuesses > 0 ? entry.totalCorrectGuesses / entry.totalGuesses : 0,
      assassinLossRate: entry.finishedGames > 0 ? entry.assassinLosses / entry.finishedGames : 0,
    }))
    .map(({ totalTurnsToFinish, totalGuesses, totalCorrectGuesses, assassinLosses, ...entry }) => entry)
    .sort((left, right) => right.winRate - left.winRate || right.wins - left.wins || left.illegalMoves - right.illegalMoves);
}

export function arenaProjection(arenaId: string, games: ArenaGameSummary[], updatedAt: number): ArenaProjection {
  const sortedGames = [...games].sort((left, right) => right.updatedAt - left.updatedAt);
  return {
    arenaId,
    games: sortedGames,
    leaderboard: buildLeaderboard(sortedGames),
    updatedAt,
  };
}
