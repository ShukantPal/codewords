import type { WireServerMessage } from '@/interfaces/commands';
import type { SpectatorProjection } from '@/interfaces/game';

export const INITIAL_GAME_ID = 'global-codewords-showdown';

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
