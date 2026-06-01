import test from 'node:test';
import assert from 'node:assert/strict';
import { arenaProjection, gameSummaryFromState } from '../cloudflare/arena/projections';
import { createInitialGameState, giveClue, makeGuess, recordIllegalMove } from '../cloudflare/game/rules';
import { createAgentSystemPromptSnapshot } from '../interfaces/agent-prompts';
import type { AgentRef } from '../interfaces/game';

const blueSpymaster: AgentRef = { team: 'blue', role: 'spymaster' };
const blueGuesser: AgentRef = { team: 'blue', role: 'guesser' };

test('arena game summary captures score metrics', () => {
  let state = createInitialGameState('arena-game', undefined, 'arena-test');
  const blueCard = state.board.find((card) => card.owner === 'blue');
  assert.ok(blueCard);

  state = giveClue(state, blueSpymaster, { word: 'sky', count: 1 });
  state = makeGuess(state, blueGuesser, { cardId: blueCard.id });
  state = recordIllegalMove(state, blueGuesser, 'test illegal move');

  const summary = gameSummaryFromState(state);
  assert.equal(summary.arenaId, 'arena-test');
  assert.equal(summary.gameId, 'arena-game');
  assert.equal(summary.metrics.clues, 1);
  assert.equal(summary.metrics.guesses, 1);
  assert.equal(summary.metrics.correctGuesses, 1);
  assert.equal(summary.metrics.illegalMoves, 1);
});

test('arena leaderboard ranks team model outcomes', () => {
  let state = createInitialGameState('arena-winner', undefined, 'arena-test');
  state = {
    ...state,
    status: 'finished',
    winner: 'blue',
    updatedAt: Date.now(),
  };

  const projection = arenaProjection(
    'arena-test',
    [gameSummaryFromState(state)],
    Date.now(),
    createAgentSystemPromptSnapshot(),
  );
  const blue = projection.leaderboard.find((entry) => entry.teams.includes('blue'));
  const red = projection.leaderboard.find((entry) => entry.teams.includes('red'));

  assert.ok(blue);
  assert.ok(red);
  assert.equal(blue.wins, 1);
  assert.equal(red.losses, 1);
});
