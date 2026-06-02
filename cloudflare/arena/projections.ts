import type {
  ArenaGameMetrics,
  ArenaGameSummary,
  ArenaLeaderboardEntry,
  ArenaProjection,
  ArenaTeamMetrics,
} from '../../interfaces/arena';
import type { AgentSystemPromptSnapshot } from '../../interfaces/agent-prompts';
import type { AgentRef, GameEvent, GameState, Team } from '../../interfaces/game';
import { modelId } from '../../interfaces/models';

function otherTeam(team: Team): Team {
  return team === 'blue' ? 'red' : 'blue';
}

function emptyMetrics(): ArenaGameMetrics {
  return {
    clues: 0,
    clueCountTotal: 0,
    guesses: 0,
    passes: 0,
    illegalMoves: 0,
    illegalClues: 0,
    illegalGuesses: 0,
    correctGuesses: 0,
    neutralReveals: 0,
    opponentReveals: 0,
    assassinReveals: 0,
  };
}

function teamMetricsFromEvents(events: GameEvent[]): Record<Team, ArenaTeamMetrics> {
  const metrics: Record<Team, ArenaTeamMetrics> = {
    blue: emptyMetrics(),
    red: emptyMetrics(),
  };

  for (const event of events) {
    if (event.type === 'clue-given') {
      const team = event.team;
      metrics[team].clues += 1;
      metrics[team].clueCountTotal += event.count;
    }
    if (event.type === 'turn-passed') {
      metrics[event.team].passes += 1;
    }
    if (event.type === 'illegal-move' && event.actor) {
      const team = event.actor.team;
      metrics[team].illegalMoves += 1;
      if (event.actor.role === 'spymaster') {
        metrics[team].illegalClues += 1;
      } else {
        metrics[team].illegalGuesses += 1;
      }
    }
    if (event.type === 'card-revealed') {
      const team = event.team;
      metrics[team].guesses += 1;
      if (event.owner === event.team) {
        metrics[team].correctGuesses += 1;
      } else if (event.owner === 'neutral') {
        metrics[team].neutralReveals += 1;
      } else if (event.owner === 'assassin') {
        metrics[team].assassinReveals += 1;
      } else {
        metrics[team].opponentReveals += 1;
      }
    }
  }

  return metrics;
}

export function metricsFromEvents(events: GameEvent[]): ArenaGameMetrics {
  const metrics = emptyMetrics();

  for (const event of events) {
    if (event.type === 'clue-given') {
      metrics.clues += 1;
      metrics.clueCountTotal += event.count;
    }
    if (event.type === 'turn-passed') {
      metrics.passes += 1;
    }
    if (event.type === 'illegal-move') {
      metrics.illegalMoves += 1;
      if (event.actor?.role === 'spymaster') {
        metrics.illegalClues += 1;
      }
      if (event.actor?.role === 'guesser') {
        metrics.illegalGuesses += 1;
      }
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
    models: state.models,
    metrics: metricsFromEvents(state.events),
    teamMetrics: teamMetricsFromEvents(state.events),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

function buildLeaderboard(games: ArenaGameSummary[]): ArenaLeaderboardEntry[] {
  const entries = new Map<string, ArenaLeaderboardEntry & {
    totalTurnsToFinish: number;
    totalClueCount: number;
    totalClues: number;
    totalGuesses: number;
    totalCorrectGuesses: number;
    totalNeutralReveals: number;
    totalOpponentReveals: number;
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
        illegalClues: 0,
        illegalGuesses: 0,
        illegalMovesPerGame: 0,
        averageTurnsToFinish: 0,
        averageClueSize: 0,
        correctGuessRate: 0,
        neutralRevealRate: 0,
        opponentRevealRate: 0,
        assassinLossRate: 0,
        totalTurnsToFinish: 0,
        totalClueCount: 0,
        totalClues: 0,
        totalGuesses: 0,
        totalCorrectGuesses: 0,
        totalNeutralReveals: 0,
        totalOpponentReveals: 0,
        assassinLosses: 0,
      };
      if (!entry.teams.includes(team)) {
        entry.teams.push(team);
      }
      entry.games += 1;
      const metrics = game.teamMetrics?.[team] ?? game.metrics;
      entry.illegalMoves += metrics.illegalMoves ?? 0;
      entry.illegalClues += metrics.illegalClues ?? 0;
      entry.illegalGuesses += metrics.illegalGuesses ?? 0;
      entry.totalClues += metrics.clues ?? 0;
      entry.totalClueCount += metrics.clueCountTotal ?? 0;
      entry.totalGuesses += metrics.guesses ?? 0;
      entry.totalCorrectGuesses += metrics.correctGuesses ?? 0;
      entry.totalNeutralReveals += metrics.neutralReveals ?? 0;
      entry.totalOpponentReveals += metrics.opponentReveals ?? 0;
      if (game.status === 'finished') {
        entry.finishedGames += 1;
        entry.totalTurnsToFinish += metrics.clues;
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
      averageClueSize: entry.totalClues > 0 ? entry.totalClueCount / entry.totalClues : 0,
      correctGuessRate: entry.totalGuesses > 0 ? entry.totalCorrectGuesses / entry.totalGuesses : 0,
      neutralRevealRate: entry.totalGuesses > 0 ? entry.totalNeutralReveals / entry.totalGuesses : 0,
      opponentRevealRate: entry.totalGuesses > 0 ? entry.totalOpponentReveals / entry.totalGuesses : 0,
      assassinLossRate: entry.finishedGames > 0 ? entry.assassinLosses / entry.finishedGames : 0,
    }))
    .map(({
      totalTurnsToFinish,
      totalClueCount,
      totalClues,
      totalGuesses,
      totalCorrectGuesses,
      totalNeutralReveals,
      totalOpponentReveals,
      assassinLosses,
      ...entry
    }) => entry)
    .sort((left, right) => right.winRate - left.winRate || right.wins - left.wins || left.illegalMoves - right.illegalMoves);
}

export function arenaProjection(
  arenaId: string,
  games: ArenaGameSummary[],
  updatedAt: number,
  systemPrompts: AgentSystemPromptSnapshot,
): ArenaProjection {
  const sortedGames = [...games].sort((left, right) => right.updatedAt - left.updatedAt);
  return {
    arenaId,
    systemPrompts,
    games: sortedGames,
    leaderboard: buildLeaderboard(sortedGames),
    updatedAt,
  };
}
