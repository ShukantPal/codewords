export type Team = 'blue' | 'red';
export type AgentRole = 'spymaster' | 'guesser';
export type CardOwner = Team | 'neutral' | 'assassin';
export type GameStatus = 'lobby' | 'active' | 'finished';
export type TurnPhase = 'clue' | 'guess';

export type AgentRef = {
  team: Team;
  role: AgentRole;
};

export type BoardCard = {
  id: string;
  word: string;
  owner: CardOwner;
  revealed: boolean;
  revealedBy?: Team;
  revealedAt?: number;
};

export type Clue = {
  word: string;
  count: number;
  givenBy: AgentRef;
  givenAt: number;
};

export type TurnState = {
  team: Team;
  phase: TurnPhase;
  clue?: Clue;
  guessesRemaining: number;
};

export type TeamState = {
  team: Team;
  wordsTotal: number;
  wordsRevealed: number;
};

export type AgentActivity = {
  team: Team;
  role: AgentRole;
  lastSeenAt?: number;
  lastActionAt?: number;
};

export type GameEvent =
  | {
      id: string;
      type: 'game-reset';
      createdAt: number;
      summary: string;
    }
  | {
      id: string;
      type: 'clue-given';
      createdAt: number;
      team: Team;
      clue: string;
      count: number;
      summary: string;
    }
  | {
      id: string;
      type: 'card-revealed';
      createdAt: number;
      team: Team;
      word: string;
      owner: CardOwner;
      summary: string;
    }
  | {
      id: string;
      type: 'turn-passed';
      createdAt: number;
      team: Team;
      summary: string;
    }
  | {
      id: string;
      type: 'game-finished';
      createdAt: number;
      winner: Team;
      summary: string;
    }
  | {
      id: string;
      type: 'protocol-message';
      createdAt: number;
      from: AgentRef;
      to?: AgentRef;
      summary: string;
    };

export type ProtocolMessage = {
  id: string;
  from: AgentRef;
  to?: AgentRef;
  body: string;
  visibility: 'public' | 'team' | 'role';
  createdAt: number;
};

export type GameState = {
  gameId: string;
  status: GameStatus;
  winner?: Team;
  board: BoardCard[];
  turn: TurnState;
  teams: Record<Team, TeamState>;
  agents: Record<Team, Record<AgentRole, AgentActivity>>;
  events: GameEvent[];
  messages: ProtocolMessage[];
  createdAt: number;
  updatedAt: number;
};

export type SpectatorCard = {
  id: string;
  word: string;
  revealed: boolean;
  owner?: CardOwner;
  revealedBy?: Team;
};

export type AgentCard = SpectatorCard;

export type ScoreState = Record<Team, TeamState>;

export type SpectatorProjection = {
  gameId: string;
  status: GameStatus;
  winner?: Team;
  board: SpectatorCard[];
  turn: TurnState;
  scores: ScoreState;
  events: GameEvent[];
  messages: ProtocolMessage[];
  showKey: boolean;
  updatedAt: number;
};

export type AgentProjection = {
  gameId: string;
  status: GameStatus;
  winner?: Team;
  team: Team;
  role: AgentRole;
  board: AgentCard[];
  turn: TurnState;
  scores: ScoreState;
  events: GameEvent[];
  messages: ProtocolMessage[];
  updatedAt: number;
};

export type ClueInput = {
  word: string;
  count: number;
};

export type GuessInput = {
  cardId?: string;
  word?: string;
};

export type ProtocolMessageInput = {
  body: string;
  to?: AgentRef;
  visibility?: ProtocolMessage['visibility'];
};
