import type {
  AgentLegalActions,
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

function legalActionsForAgent(state: GameState, agent: AgentRef): AgentLegalActions {
  const baseTools: AgentLegalActions['legalTools'] = [
    'get_board',
    'get_turn',
    'read_protocol_messages',
    'send_protocol_message',
  ];
  const stopConditions = [
    'The game is not active.',
    `The current team is not ${agent.team}.`,
    `The current phase is not ${agent.role === 'spymaster' ? 'clue' : 'guess'}.`,
    'A tool result shows the game, team, or phase changed.',
  ];

  if (state.status !== 'active') {
    return {
      canAct: false,
      reason: `Game is ${state.status}.`,
      legalTools: baseTools,
      instruction: 'Do not make a game move. Stop this session.',
      stopConditions,
    };
  }

  if (state.turn.team !== agent.team) {
    return {
      canAct: false,
      reason: `It is ${state.turn.team}'s turn.`,
      legalTools: baseTools,
      instruction: 'Do not make a game move. Stop this session.',
      stopConditions,
    };
  }

  if (agent.role === 'spymaster') {
    if (state.turn.phase !== 'clue') {
      return {
        canAct: false,
        reason: `It is ${agent.team}'s guess phase; the spymaster must not act.`,
        legalTools: baseTools,
        instruction: 'Do not give a clue or guess. Stop this session.',
        stopConditions,
      };
    }

    return {
      canAct: true,
      reason: `${agent.team} spymaster must give exactly one clue.`,
      legalTools: [...baseTools, 'give_clue'],
      expectedMove: 'give_clue',
      instruction: 'Call give_clue exactly once, then stop. Do not guess.',
      clueRules: [
        'One English word only.',
        'Letters A-Z only; no spaces, hyphens, punctuation, or digits.',
        'Must not exactly match any board word.',
        'Must not be a prefix of any board word.',
        'Must not have any board word as its prefix.',
      ],
      stopConditions,
    };
  }

  if (state.turn.phase !== 'guess') {
    return {
      canAct: false,
      reason: `It is ${agent.team}'s clue phase; the guesser must not act.`,
      legalTools: baseTools,
      instruction: 'Do not guess or pass. Stop this session.',
      stopConditions,
    };
  }

  if (state.turn.guessesRemaining < 1) {
    return {
      canAct: true,
      reason: 'No guesses remain.',
      legalTools: [...baseTools, 'pass_turn'],
      expectedMove: 'pass_turn',
      instruction: 'Call pass_turn exactly once, then stop.',
      guessesRemaining: state.turn.guessesRemaining,
      allowedGuessWords: state.board.filter((card) => !card.revealed).map((card) => card.word),
      stopConditions,
    };
  }

  return {
    canAct: true,
    reason: `${agent.team} guesser may guess or pass.`,
    legalTools: [...baseTools, 'make_guess', 'pass_turn'],
    expectedMove: 'make_guess',
    instruction: 'Call make_guess for one unrevealed board word if confidence is reasonable. After the result, re-check legalActions before any next move. If confidence is low, call pass_turn exactly once and stop.',
    guessesRemaining: state.turn.guessesRemaining,
    allowedGuessWords: state.board.filter((card) => !card.revealed).map((card) => card.word),
    stopConditions: [
      ...stopConditions,
      'guessesRemaining is 0.',
      'The last revealed card belonged to the other team, neutral, or assassin.',
      'You called pass_turn.',
    ],
  };
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
    models: state.models,
    activeTalonSession: visibleActiveTalonSession(state),
    talonTriggerSessions: (state.talonTriggerSessions ?? []).slice(-50),
    review: state.review,
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
    legalActions: legalActionsForAgent(state, agent),
    board: state.board.map((card) => ({
      id: card.id,
      word: card.word,
      revealed: card.revealed,
      owner: isSpymaster || card.revealed ? card.owner : undefined,
      revealedBy: card.revealedBy,
    })),
    turn: state.turn,
    scores: state.teams,
    models: state.models,
    activeTalonSession: visibleActiveTalonSession(state, agent),
    talonTriggerSessions: (state.talonTriggerSessions ?? []).slice(-50),
    events: state.events.slice(-50),
    messages: readProtocolMessages(state, agent).slice(-50),
    updatedAt: state.updatedAt,
  };
}
