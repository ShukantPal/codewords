import type { WireClientMessage, WireServerMessage } from '../../interfaces/commands';

export type ClientAttachment = {
  id: string;
  showKey: boolean;
};

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {}),
    },
  });
}

export function createWebSocketUpgradeResponse(client: WebSocket): Response {
  return new Response(null, {
    status: 101,
    webSocket: client,
  } as ResponseInit & { webSocket: WebSocket });
}

export function encodeMessage(message: WireServerMessage): string {
  return JSON.stringify(message);
}

export function decodeMessage(rawMessage: string): WireClientMessage | undefined {
  try {
    const parsed = JSON.parse(rawMessage) as Partial<WireClientMessage>;
    if (parsed.type === 'subscribe') {
      return {
        type: 'subscribe',
        showKey: Boolean(parsed.showKey),
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
