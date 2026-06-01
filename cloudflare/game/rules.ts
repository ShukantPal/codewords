import type {
  AgentRef,
  BoardCard,
  CardOwner,
  ClueInput,
  GameEvent,
  GameState,
  GuessInput,
  ProtocolMessage,
  ProtocolMessageInput,
  Team,
  TeamState,
} from '../../interfaces/game';
import type { TeamModelConfig } from '../../interfaces/models';
import { TEAM_MODEL_CONFIGS } from '../../interfaces/models';
import { WORD_BANK } from './word-bank';

const BOARD_SIZE = 25;
const FIRST_TEAM: Team = 'blue';
type RandomSource = () => number;
type NewGameEvent = GameEvent extends infer Event
  ? Event extends GameEvent
    ? Omit<Event, 'id' | 'createdAt'>
    : never
  : never;

function now(): number {
  return Date.now();
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function otherTeam(team: Team): Team {
  return team === 'blue' ? 'red' : 'blue';
}

function secureRandom(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] / 4294967296;
}

function shuffle<T>(values: T[], random: RandomSource): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function createOwners(): CardOwner[] {
  return [
    ...Array<CardOwner>(9).fill('blue'),
    ...Array<CardOwner>(8).fill('red'),
    ...Array<CardOwner>(7).fill('neutral'),
    'assassin',
  ];
}

function createBoard(random: RandomSource = secureRandom): BoardCard[] {
  const words = shuffle(WORD_BANK, random).slice(0, BOARD_SIZE);
  const owners = shuffle(createOwners(), random);
  return words.map((word, index) => ({
    id: `card-${index + 1}`,
    word,
    owner: owners[index],
    revealed: false,
  }));
}

function summarizeTeams(board: BoardCard[]): Record<Team, TeamState> {
  return {
    blue: {
      team: 'blue',
      wordsTotal: board.filter((card) => card.owner === 'blue').length,
      wordsRevealed: board.filter((card) => card.owner === 'blue' && card.revealed).length,
    },
    red: {
      team: 'red',
      wordsTotal: board.filter((card) => card.owner === 'red').length,
      wordsRevealed: board.filter((card) => card.owner === 'red' && card.revealed).length,
    },
  };
}

function withScores(state: GameState): GameState {
  return { ...state, teams: summarizeTeams(state.board), updatedAt: now() };
}

function appendEvent(state: GameState, event: NewGameEvent): GameState {
  const entry = {
    ...event,
    id: makeId('event'),
    createdAt: now(),
  } as GameEvent;
  return {
    ...state,
    events: [...state.events, entry].slice(-100),
    updatedAt: entry.createdAt,
  };
}

function touchAgent(state: GameState, agent: AgentRef): GameState {
  return {
    ...state,
    agents: {
      ...state.agents,
      [agent.team]: {
        ...state.agents[agent.team],
        [agent.role]: {
          ...state.agents[agent.team][agent.role],
          lastSeenAt: now(),
          lastActionAt: now(),
        },
      },
    },
  };
}

function assertActive(state: GameState): void {
  if (state.status !== 'active') {
    throw new Error(`Game is ${state.status}; moves are only allowed while active.`);
  }
}

function assertCurrentTeam(state: GameState, agent: AgentRef): void {
  if (state.turn.team !== agent.team) {
    throw new Error(`It is ${state.turn.team}'s turn.`);
  }
}

function assertLegalClueWord(state: GameState, clueWord: string): void {
  if (!/^[A-Za-z]+$/.test(clueWord)) {
    throw new Error('Clue must be one English word using letters only.');
  }

  const normalizedClue = clueWord.toLowerCase();
  const matchingCard = state.board.find((card) => {
    const normalizedWord = card.word.toLowerCase();
    return normalizedClue === normalizedWord
      || normalizedWord.startsWith(normalizedClue)
      || normalizedClue.startsWith(normalizedWord);
  });

  if (matchingCard) {
    throw new Error(`Clue must not match or prefix a board word: ${matchingCard.word}.`);
  }
}

export function createInitialGameState(
  gameId: string,
  random: RandomSource = secureRandom,
  arenaId = 'main',
  models: Record<Team, TeamModelConfig> = TEAM_MODEL_CONFIGS,
): GameState {
  const createdAt = now();
  const board = createBoard(random);
  const base: GameState = {
    arenaId,
    gameId,
    status: 'active',
    board,
    turn: {
      team: FIRST_TEAM,
      phase: 'clue',
      guessesRemaining: 0,
    },
    teams: summarizeTeams(board),
    models,
    agents: {
      blue: {
        spymaster: { team: 'blue', role: 'spymaster' },
        guesser: { team: 'blue', role: 'guesser' },
      },
      red: {
        spymaster: { team: 'red', role: 'spymaster' },
        guesser: { team: 'red', role: 'guesser' },
      },
    },
    events: [],
    messages: [],
    createdAt,
    updatedAt: createdAt,
  };

  return appendEvent(base, {
    type: 'game-reset',
    summary: `Game ${gameId} started.`,
  });
}

export function resetGame(
  gameId: string,
  arenaId = 'main',
  models: Record<Team, TeamModelConfig> = TEAM_MODEL_CONFIGS,
): GameState {
  return createInitialGameState(gameId, secureRandom, arenaId, models);
}

export function recordIllegalMove(state: GameState, agent: AgentRef | undefined, error: string): GameState {
  return appendEvent({
    ...state,
    updatedAt: now(),
  }, {
    type: 'illegal-move',
    actor: agent,
    error,
    summary: agent
      ? `${agent.team} ${agent.role} made an illegal move: ${error}`
      : `Illegal move: ${error}`,
  });
}

export function giveClue(state: GameState, agent: AgentRef, input: ClueInput): GameState {
  assertActive(state);
  assertCurrentTeam(state, agent);
  if (agent.role !== 'spymaster') {
    throw new Error('Only the current spymaster can give a clue.');
  }
  if (state.turn.phase !== 'clue') {
    throw new Error('A clue can only be given during the clue phase.');
  }

  const clueWord = input.word.trim();
  if (!clueWord) {
    throw new Error('Clue word is required.');
  }
  assertLegalClueWord(state, clueWord);
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 9) {
    throw new Error('Clue count must be an integer between 1 and 9.');
  }

  const next = touchAgent({
    ...state,
    turn: {
      team: agent.team,
      phase: 'guess',
      clue: {
        word: clueWord,
        count: input.count,
        givenBy: agent,
        givenAt: now(),
      },
      guessesRemaining: input.count + 1,
    },
    updatedAt: now(),
  }, agent);

  return appendEvent(next, {
    type: 'clue-given',
    team: agent.team,
    actor: agent,
    clue: clueWord,
    count: input.count,
    summary: `${agent.team} ${agent.role} gave clue: ${clueWord} ${input.count}.`,
  });
}

function finishGame(state: GameState, winner: Team, summary: string, actor?: AgentRef): GameState {
  return appendEvent({
    ...state,
    status: 'finished',
    winner,
    updatedAt: now(),
  }, {
    type: 'game-finished',
    winner,
    actor,
    summary,
  });
}

function nextTurn(state: GameState): GameState {
  return {
    ...state,
    turn: {
      team: otherTeam(state.turn.team),
      phase: 'clue',
      guessesRemaining: 0,
    },
    updatedAt: now(),
  };
}

function winnerFromScores(state: GameState): Team | undefined {
  if (state.teams.blue.wordsRevealed >= state.teams.blue.wordsTotal) {
    return 'blue';
  }
  if (state.teams.red.wordsRevealed >= state.teams.red.wordsTotal) {
    return 'red';
  }
  return undefined;
}

export function makeGuess(state: GameState, agent: AgentRef, input: GuessInput): GameState {
  assertActive(state);
  assertCurrentTeam(state, agent);
  if (agent.role !== 'guesser') {
    throw new Error('Only the current guesser can make a guess.');
  }
  if (state.turn.phase !== 'guess') {
    throw new Error('A guess can only be made during the guess phase.');
  }
  if (state.turn.guessesRemaining < 1) {
    throw new Error('No guesses remain for this turn.');
  }

  const normalizedWord = input.word?.trim().toLowerCase();
  const cardIndex = state.board.findIndex((card) => {
    if (input.cardId && card.id === input.cardId) {
      return true;
    }
    return Boolean(normalizedWord && card.word.toLowerCase() === normalizedWord);
  });

  if (cardIndex < 0) {
    throw new Error('Could not find the guessed card.');
  }

  const card = state.board[cardIndex];
  if (card.revealed) {
    throw new Error(`${card.word} has already been revealed.`);
  }

  const revealedCard: BoardCard = {
    ...card,
    revealed: true,
    revealedBy: agent.team,
    revealedAt: now(),
  };
  const nextBoard = [...state.board];
  nextBoard[cardIndex] = revealedCard;

  let next = withScores(touchAgent({
    ...state,
    board: nextBoard,
    turn: {
      ...state.turn,
      guessesRemaining: state.turn.guessesRemaining - 1,
    },
  }, agent));

  next = appendEvent(next, {
    type: 'card-revealed',
    team: agent.team,
    actor: agent,
    word: revealedCard.word,
    owner: revealedCard.owner,
    summary: `${agent.team} ${agent.role} revealed ${revealedCard.word} (${revealedCard.owner}).`,
  });

  if (revealedCard.owner === 'assassin') {
    return finishGame(next, otherTeam(agent.team), `${agent.team} ${agent.role} hit the assassin.`, agent);
  }

  const winner = winnerFromScores(next);
  if (winner) {
    return finishGame(next, winner, `${winner} won after ${agent.team} ${agent.role} revealed all ${winner} words.`, agent);
  }

  if (revealedCard.owner !== agent.team || next.turn.guessesRemaining === 0) {
    return nextTurn(next);
  }

  return next;
}

export function passTurn(state: GameState, agent: AgentRef): GameState {
  assertActive(state);
  assertCurrentTeam(state, agent);
  if (agent.role !== 'guesser') {
    throw new Error('Only the current guesser can pass.');
  }
  if (state.turn.phase !== 'guess') {
    throw new Error('Passing is only allowed during the guess phase.');
  }

  return appendEvent(touchAgent(nextTurn(state), agent), {
    type: 'turn-passed',
    team: agent.team,
    actor: agent,
    summary: `${agent.team} ${agent.role} passed.`,
  });
}

export function sendProtocolMessage(
  state: GameState,
  agent: AgentRef,
  input: ProtocolMessageInput,
): GameState {
  const body = input.body.trim();
  if (!body) {
    throw new Error('Message body is required.');
  }

  const createdAt = now();
  const message: ProtocolMessage = {
    id: makeId('msg'),
    from: agent,
    to: input.to,
    body,
    visibility: input.visibility ?? 'public',
    createdAt,
  };

  return appendEvent(touchAgent({
    ...state,
    messages: [...state.messages, message].slice(-100),
    updatedAt: createdAt,
  }, agent), {
    type: 'protocol-message',
    from: agent,
    to: input.to,
    summary: `${agent.team} ${agent.role} sent a protocol message.`,
  });
}

export function submitReview(state: GameState, reviewer: string, summary: string): GameState {
  const body = summary.trim();
  if (!body) {
    throw new Error('Review summary is required.');
  }

  if (state.status !== 'finished') {
    throw new Error('Game reviews can only be submitted after the game is finished.');
  }

  const completedAt = now();
  return appendEvent({
    ...state,
    review: {
      ...(state.review ?? {
        status: 'pending',
        reviewer,
        requestedAt: completedAt,
      }),
      status: 'complete',
      reviewer,
      completedAt,
      summary: body,
    },
    updatedAt: completedAt,
  }, {
    type: 'game-reviewed',
    reviewer,
    summary: `${reviewer} reviewed the game.`,
  });
}

export function readProtocolMessages(state: GameState, agent: AgentRef): ProtocolMessage[] {
  return state.messages.filter((message) => {
    if (message.visibility === 'public') {
      return true;
    }
    if (message.visibility === 'team') {
      return message.from.team === agent.team || message.to?.team === agent.team;
    }
    return (
      (message.from.team === agent.team && message.from.role === agent.role) ||
      (message.to?.team === agent.team && message.to.role === agent.role)
    );
  });
}
