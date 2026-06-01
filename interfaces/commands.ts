import type {
  AgentProjection,
  AgentRef,
  ClueInput,
  GameState,
  GuessInput,
  ProtocolMessageInput,
  SpectatorProjection,
  Team,
} from './game';
import type { TeamModelConfig } from './models';

export type ProjectionRequest =
  | { type: 'spectator'; showKey?: boolean }
  | { type: 'agent'; agent: AgentRef };

export type InternalCommand =
  | { type: 'get-state'; projection: ProjectionRequest }
  | { type: 'reset-game'; models?: Record<Team, TeamModelConfig> }
  | { type: 'trigger-current-agent'; projection: ProjectionRequest }
  | { type: 'give-clue'; agent: AgentRef; payload: ClueInput }
  | { type: 'make-guess'; agent: AgentRef; payload: GuessInput }
  | { type: 'pass-turn'; agent: AgentRef }
  | { type: 'send-protocol-message'; agent: AgentRef; payload: ProtocolMessageInput }
  | { type: 'read-protocol-messages'; agent: AgentRef };

export type InternalCommandResult =
  | SpectatorProjection
  | AgentProjection
  | GameState['messages'];

export type WireClientMessage =
  | { type: 'subscribe'; showKey?: boolean };

export type WireServerMessage =
  | { type: 'state-update'; payload: SpectatorProjection }
  | { type: 'error'; payload: { message: string } };

export type TeamRolePath = {
  gameId: string;
  team: Team;
  role: AgentRef['role'];
};
