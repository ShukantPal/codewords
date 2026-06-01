import type { WireServerMessage } from '@/interfaces/commands';
import type { ArenaProjection, ArenaWireServerMessage } from '@/interfaces/arena';
import type { AgentRole, SpectatorProjection, Team } from '@/interfaces/game';

export const INITIAL_GAME_ID = 'main';
export const INITIAL_ARENA_ID = 'main';

export type TalonChannelSession = {
  arenaId: string;
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
  arenaId: string;
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

function apiGamePath(arenaId: string, gameId: string, showKey: boolean): string {
  const params = new URLSearchParams({ showKey: String(showKey) });
  return `/api/arenas/${encodeURIComponent(arenaId)}/games/${encodeURIComponent(gameId)}?${params.toString()}`;
}

function wsArenaPath(arenaId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/arenas/${encodeURIComponent(arenaId)}`;
}

function wsGamePath(arenaId: string, gameId: string, showKey: boolean): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ showKey: String(showKey) });
  return `${protocol}//${window.location.host}/ws/arenas/${encodeURIComponent(arenaId)}/games/${encodeURIComponent(gameId)}?${params.toString()}`;
}

export async function fetchArena(arenaId: string): Promise<ArenaProjection> {
  const response = await fetch(`/api/arenas/${encodeURIComponent(arenaId)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch arena ${arenaId}: ${response.status}`);
  }
  return response.json<ArenaProjection>();
}

export async function createArenaGames(arenaId: string, count?: number): Promise<ArenaProjection> {
  const response = await fetch(`/api/arenas/${encodeURIComponent(arenaId)}/games`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...(count === undefined ? {} : { count }), prefix: 'game' }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create arena games: ${response.status}`);
  }
  const body = await response.json<{ arena: ArenaProjection }>();
  return body.arena;
}

export async function deleteArenaGame(arenaId: string, gameId: string): Promise<ArenaProjection> {
  const response = await fetch(`/api/arenas/${encodeURIComponent(arenaId)}/games/${encodeURIComponent(gameId)}`, {
    method: 'DELETE',
    headers: {
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to delete arena game: ${response.status}`);
  }
  const body = await response.json<{ arena: ArenaProjection }>();
  return body.arena;
}

export async function fetchSpectatorGame(arenaId: string, gameId: string, showKey: boolean): Promise<SpectatorProjection> {
  const response = await fetch(apiGamePath(arenaId, gameId, showKey), {
    headers: {
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${gameId}: ${response.status}`);
  }
  return response.json<SpectatorProjection>();
}

export async function triggerCurrentAgent(arenaId: string, gameId: string, showKey: boolean): Promise<SpectatorProjection> {
  const params = new URLSearchParams({ showKey: String(showKey) });
  const response = await fetch(`/api/arenas/${encodeURIComponent(arenaId)}/games/${encodeURIComponent(gameId)}/trigger?${params.toString()}`, {
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

export async function restartGame(arenaId: string, gameId: string): Promise<SpectatorProjection> {
  const response = await fetch(`/api/arenas/${encodeURIComponent(arenaId)}/games/${encodeURIComponent(gameId)}/reset`, {
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

export async function fetchTalonChannelSession(arenaId: string, gameId: string): Promise<TalonChannelSession> {
  const response = await fetch(`/talon/arenas/${encodeURIComponent(arenaId)}/games/${encodeURIComponent(gameId)}/channel-token`, {
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
  arenaId: string,
  gameId: string,
  team: Team,
  role: AgentRole,
  agentName?: string,
): Promise<TalonAgentSession> {
  const params = new URLSearchParams();
  if (agentName) {
    params.set('agentName', agentName);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const response = await fetch(
    `/talon/arenas/${encodeURIComponent(arenaId)}/games/${encodeURIComponent(gameId)}/${team}/${role}/session-token${suffix}`,
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
  arenaId: string,
  gameId: string,
  showKey: boolean,
  onState: (state: SpectatorProjection) => void,
  onError: (error: Error) => void,
): () => void {
  const socket = new WebSocket(wsGamePath(arenaId, gameId, showKey));

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

export function subscribeToArena(
  arenaId: string,
  onState: (state: ArenaProjection) => void,
  onError: (error: Error) => void,
): () => void {
  const socket = new WebSocket(wsArenaPath(arenaId));

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'subscribe' }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as ArenaWireServerMessage;
    if (message.type === 'arena-update') {
      onState(message.payload);
    }
    if (message.type === 'error') {
      onError(new Error(message.payload.message));
    }
  });

  socket.addEventListener('error', () => {
    onError(new Error('Arena WebSocket connection failed.'));
  });

  return () => {
    socket.close();
  };
}
