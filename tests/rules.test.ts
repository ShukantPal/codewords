import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentRef } from '../interfaces/game';
import {
  createInitialGameState,
  giveClue,
  makeGuess,
  passTurn,
  sendProtocolMessage,
} from '../cloudflare/game/rules';

const blueSpymaster: AgentRef = { team: 'blue', role: 'spymaster' };
const blueGuesser: AgentRef = { team: 'blue', role: 'guesser' };
const redSpymaster: AgentRef = { team: 'red', role: 'spymaster' };

test('creates a valid 25-card board distribution', () => {
  const state = createInitialGameState('rules-board');
  const owners = state.board.map((card) => card.owner);

  assert.equal(state.board.length, 25);
  assert.equal(owners.filter((owner) => owner === 'blue').length, 9);
  assert.equal(owners.filter((owner) => owner === 'red').length, 8);
  assert.equal(owners.filter((owner) => owner === 'neutral').length, 7);
  assert.equal(owners.filter((owner) => owner === 'assassin').length, 1);
  assert.equal(state.turn.team, 'blue');
  assert.equal(state.turn.phase, 'clue');
});

test('enforces spymaster clue and guesser turn flow', () => {
  let state = createInitialGameState('rules-flow');

  assert.throws(() => giveClue(state, redSpymaster, { word: 'sky', count: 2 }), /blue's turn/);
  assert.throws(() => makeGuess(state, blueGuesser, { word: state.board[0].word }), /guess phase/);

  state = giveClue(state, blueSpymaster, { word: 'signal', count: 2 });

  assert.equal(state.turn.phase, 'guess');
  assert.equal(state.turn.guessesRemaining, 3);
  assert.throws(() => passTurn(state, blueSpymaster), /Only the current guesser/);
});

test('correct guesses continue until pass moves to the next team', () => {
  let state = createInitialGameState('rules-pass');
  const blueCard = state.board.find((card) => card.owner === 'blue');
  assert.ok(blueCard);

  state = giveClue(state, blueSpymaster, { word: 'blue', count: 1 });
  state = makeGuess(state, blueGuesser, { cardId: blueCard.id });

  assert.equal(state.turn.team, 'blue');
  assert.equal(state.turn.phase, 'guess');
  assert.equal(state.turn.guessesRemaining, 1);

  state = passTurn(state, blueGuesser);
  assert.equal(state.turn.team, 'red');
  assert.equal(state.turn.phase, 'clue');
});

test('assassin guess finishes the game for the other team', () => {
  let state = createInitialGameState('rules-assassin');
  const assassin = state.board.find((card) => card.owner === 'assassin');
  assert.ok(assassin);

  state = giveClue(state, blueSpymaster, { word: 'danger', count: 1 });
  state = makeGuess(state, blueGuesser, { cardId: assassin.id });

  assert.equal(state.status, 'finished');
  assert.equal(state.winner, 'red');
});

test('stores visible protocol messages', () => {
  let state = createInitialGameState('rules-message');
  state = sendProtocolMessage(state, blueSpymaster, {
    body: 'Proposal: clue around orbit terms.',
    visibility: 'public',
  });

  assert.equal(state.messages.length, 1);
  assert.equal(state.events.at(-1)?.type, 'protocol-message');
});
