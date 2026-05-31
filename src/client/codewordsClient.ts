import type { WireServerMessage } from '@/interfaces/commands';
import type { AgentRole, SpectatorProjection, Team } from '@/interfaces/game';

export const INITIAL_GAME_ID = 'main';

export type TalonChannelSession = {
  gameId: string;
  namespace: string;
  channel: string;
  token: string;
  expiresInSeconds: number;
  talon: {
    baseUrl: string;
    channelStreamUrl: string;
    channelMessagesUrl: string;
    setup: {
      ok: boolean;
      agents?: string[];
      subscriptions?: string[];
      error?: string;
    };
  };
};

export type TalonAgentSession = {
  gameId: string;
  team: Team;
  role: AgentRole;
  token: string;
  agentToken: string;
  namespace: string;
  agent: string;
  sessionId: string;
  expiresInSeconds: number;
  talon: {
    baseUrl: string;
  };
};

function apiGamePath(gameId: string, showKey: boolean): string {
  const params = new URLSearchParams({ showKey: String(showKey) });
  return `/api/games/${encodeURIComponent(gameId)}?${params.toString()}`;
}

function wsGamePath(gameId: string, showKey: boolean): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ showKey: String(showKey) });
  return `${protocol}//${window.location.host}/ws/games/${encodeURIComponent(gameId)}?${params.toString()}`;
}

export async function fetchSpectatorGame(gameId: string, showKey: boolean): Promise<SpectatorProjection> {
  const response = await fetch(apiGamePath(gameId, showKey), {
    headers: {
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${gameId}: ${response.status}`);
  }
  return response.json<SpectatorProjection>();
}

export async function triggerCurrentAgent(gameId: string, showKey: boolean): Promise<SpectatorProjection> {
  const params = new URLSearchParams({ showKey: String(showKey) });
  const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/trigger?${params.toString()}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to trigger ${gameId}: ${response.status}`);
  }
  return response.json<SpectatorProjection>();
}

export async function restartGame(gameId: string): Promise<SpectatorProjection> {
  const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/reset`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to restart ${gameId}: ${response.status}`);
  }
  return response.json<SpectatorProjection>();
}

export async function fetchTalonChannelSession(gameId: string): Promise<TalonChannelSession> {
  const response = await fetch(`/talon/games/${encodeURIComponent(gameId)}/channel-token`, {
    headers: {
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Talon channel: ${response.status}`);
  }
  return response.json<TalonChannelSession>();
}

export async function fetchTalonAgentSession(
  gameId: string,
  team: Team,
  role: AgentRole,
): Promise<TalonAgentSession> {
  const response = await fetch(
    `/talon/games/${encodeURIComponent(gameId)}/${team}/${role}/session-token`,
    {
      headers: {
        accept: 'application/json',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Talon agent session: ${response.status}`);
  }
  return response.json<TalonAgentSession>();
}

export function subscribeToGame(
  gameId: string,
  showKey: boolean,
  onState: (state: SpectatorProjection) => void,
  onError: (error: Error) => void,
): () => void {
  const socket = new WebSocket(wsGamePath(gameId, showKey));

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'subscribe', showKey }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as WireServerMessage;
    if (message.type === 'state-update') {
      onState(message.payload);
    }
    if (message.type === 'error') {
      onError(new Error(message.payload.message));
    }
  });

  socket.addEventListener('error', () => {
    onError(new Error('WebSocket connection failed.'));
  });

  return () => {
    socket.close();
  };
}
