import type { InternalCommand, InternalCommandResult } from '../../interfaces/commands';
import type { GameState } from '../../interfaces/game';
import { getAgentProjection, getSpectatorProjection } from '../game/projections';
import {
  giveClue,
  makeGuess,
  passTurn,
  readProtocolMessages,
  recordIllegalMove,
  resetGame,
  sendProtocolMessage,
  submitReview,
} from '../game/rules';

export type ApplyCommandResult = {
  state: GameState;
  result: InternalCommandResult;
  changed: boolean;
};

export function applyInternalCommand(state: GameState, command: InternalCommand): ApplyCommandResult {
  switch (command.type) {
    case 'get-state': {
      const result = command.projection.type === 'spectator'
        ? getSpectatorProjection(state, command.projection.showKey)
        : getAgentProjection(state, command.projection.agent);
      return { state, result, changed: false };
    }
    case 'reset-game': {
      const next = resetGame(state.gameId, state.arenaId, command.models ?? state.models);
      return { state: next, result: getSpectatorProjection(next, true), changed: true };
    }
    case 'trigger-current-agent': {
      const result = command.projection.type === 'spectator'
        ? getSpectatorProjection(state, command.projection.showKey)
        : getAgentProjection(state, command.projection.agent);
      return { state, result, changed: false };
    }
    case 'give-clue': {
      const next = giveClue(state, command.agent, command.payload);
      return { state: next, result: getAgentProjection(next, command.agent), changed: true };
    }
    case 'make-guess': {
      const next = makeGuess(state, command.agent, command.payload);
      return { state: next, result: getAgentProjection(next, command.agent), changed: true };
    }
    case 'pass-turn': {
      const next = passTurn(state, command.agent);
      return { state: next, result: getAgentProjection(next, command.agent), changed: true };
    }
    case 'send-protocol-message': {
      const next = sendProtocolMessage(state, command.agent, command.payload);
      return { state: next, result: getAgentProjection(next, command.agent), changed: true };
    }
    case 'submit-review': {
      const next = submitReview(state, command.reviewer, command.payload.summary);
      return { state: next, result: getSpectatorProjection(next, true), changed: true };
    }
    case 'read-protocol-messages':
      return { state, result: readProtocolMessages(state, command.agent), changed: false };
    default:
      throw new Error(`Unsupported command type: ${(command as { type: string }).type}`);
  }
}

export function recordCommandError(state: GameState, command: InternalCommand, error: Error): GameState | undefined {
  if (
    command.type !== 'give-clue' &&
    command.type !== 'make-guess' &&
    command.type !== 'pass-turn' &&
    command.type !== 'send-protocol-message'
  ) {
    return undefined;
  }
  return recordIllegalMove(state, command.agent, error.message);
}
