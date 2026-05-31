import type {
  AgentProjection,
  AgentRef,
  GameState,
  ProtocolMessage,
  SpectatorProjection,
} from '../../interfaces/game';
import { readProtocolMessages } from './rules';

function visibleMessagesForSpectator(messages: ProtocolMessage[]): ProtocolMessage[] {
  return messages.filter((message) => message.visibility === 'public');
}

export function getSpectatorProjection(state: GameState, showKey = false): SpectatorProjection {
  return {
    gameId: state.gameId,
    status: state.status,
    winner: state.winner,
    board: state.board.map((card) => ({
      id: card.id,
      word: card.word,
      revealed: card.revealed,
      owner: showKey || card.revealed ? card.owner : undefined,
      revealedBy: card.revealedBy,
    })),
    turn: state.turn,
    scores: state.teams,
    events: state.events.slice(-50),
    messages: visibleMessagesForSpectator(state.messages).slice(-50),
    showKey,
    updatedAt: state.updatedAt,
  };
}

export function getAgentProjection(state: GameState, agent: AgentRef): AgentProjection {
  const isSpymaster = agent.role === 'spymaster';
  return {
    gameId: state.gameId,
    status: state.status,
    winner: state.winner,
    team: agent.team,
    role: agent.role,
    board: state.board.map((card) => ({
      id: card.id,
      word: card.word,
      revealed: card.revealed,
      owner: isSpymaster || card.revealed ? card.owner : undefined,
      revealedBy: card.revealedBy,
    })),
    turn: state.turn,
    scores: state.teams,
    events: state.events.slice(-50),
    messages: readProtocolMessages(state, agent).slice(-50),
    updatedAt: state.updatedAt,
  };
}
