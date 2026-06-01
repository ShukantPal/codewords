import type {
  AgentRole,
  AgentProjection,
  AgentRef,
  GameState,
  ProtocolMessage,
  SpectatorProjection,
  TalonActiveSession,
} from '../../interfaces/game';
import { readProtocolMessages } from './rules';

function visibleMessagesForSpectator(messages: ProtocolMessage[]): ProtocolMessage[] {
  return messages.filter((message) => message.visibility === 'public');
}

function currentAgentRef(state: GameState): AgentRef | undefined {
  if (state.status !== 'active') {
    return undefined;
  }
  return {
    team: state.turn.team,
    role: (state.turn.phase === 'clue' ? 'spymaster' : 'guesser') as AgentRole,
  };
}

function visibleActiveTalonSession(state: GameState, agent?: AgentRef): TalonActiveSession | undefined {
  const activeAgent = agent ?? currentAgentRef(state);
  const session = state.activeTalonSession;
  if (!activeAgent || !session) {
    return undefined;
  }
  if (session.team !== activeAgent.team || session.role !== activeAgent.role) {
    return undefined;
  }
  return session;
}

export function getSpectatorProjection(state: GameState, showKey = false): SpectatorProjection {
  return {
    arenaId: state.arenaId,
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
    activeTalonSession: visibleActiveTalonSession(state),
    talonTriggerSessions: (state.talonTriggerSessions ?? []).slice(-50),
    events: state.events.slice(-50),
    messages: visibleMessagesForSpectator(state.messages).slice(-50),
    showKey,
    updatedAt: state.updatedAt,
  };
}

export function getAgentProjection(state: GameState, agent: AgentRef): AgentProjection {
  const isSpymaster = agent.role === 'spymaster';
  return {
    arenaId: state.arenaId,
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
    activeTalonSession: visibleActiveTalonSession(state, agent),
    talonTriggerSessions: (state.talonTriggerSessions ?? []).slice(-50),
    events: state.events.slice(-50),
    messages: readProtocolMessages(state, agent).slice(-50),
    updatedAt: state.updatedAt,
  };
}
