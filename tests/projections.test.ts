import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentRef } from '../interfaces/game';
import { createInitialGameState, sendProtocolMessage } from '../cloudflare/game/rules';
import { getAgentProjection, getSpectatorProjection } from '../cloudflare/game/projections';

const blueSpymaster: AgentRef = { team: 'blue', role: 'spymaster' };
const blueGuesser: AgentRef = { team: 'blue', role: 'guesser' };
const redGuesser: AgentRef = { team: 'red', role: 'guesser' };

test('spectator projection respects showKey', () => {
  const state = createInitialGameState('projection-spectator');
  const hidden = getSpectatorProjection(state, false);
  const keyed = getSpectatorProjection(state, true);

  assert.equal(hidden.board.some((card) => card.owner), false);
  assert.equal(keyed.board.every((card) => card.owner), true);
});

test('spymaster sees owners and guesser does not see hidden owners', () => {
  const state = createInitialGameState('projection-agent');
  const spymaster = getAgentProjection(state, blueSpymaster);
  const guesser = getAgentProjection(state, blueGuesser);

  assert.equal(spymaster.board.every((card) => card.owner), true);
  assert.equal(guesser.board.some((card) => card.owner), false);
});

test('role and team protocol messages are filtered', () => {
  let state = createInitialGameState('projection-messages');
  state = sendProtocolMessage(state, blueSpymaster, {
    body: 'Blue team only.',
    visibility: 'team',
  });
  state = sendProtocolMessage(state, blueSpymaster, {
    body: 'Spymaster only.',
    visibility: 'role',
    to: blueSpymaster,
  });

  const blueView = getAgentProjection(state, blueGuesser);
  const redView = getAgentProjection(state, redGuesser);
  const spymasterView = getAgentProjection(state, blueSpymaster);

  assert.equal(blueView.messages.length, 1);
  assert.equal(redView.messages.length, 0);
  assert.equal(spymasterView.messages.length, 2);
});
