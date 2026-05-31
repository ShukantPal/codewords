import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import type { InternalCommand } from '../../interfaces/commands';
import type { GameState } from '../../interfaces/game';
import { getSpectatorProjection } from '../game/projections';
import { applyInternalCommand } from './commands';
import {
  createWebSocketUpgradeResponse,
  decodeMessage,
  encodeMessage,
  jsonResponse,
  type ClientAttachment,
} from './socket-protocol';
import { loadGameState, persistGameState } from './repository';
import { triggerTalonAgentForState } from '../routes/talon';

function getGameIdFromRequest(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get('gameId') || url.hostname || 'global-codewords-showdown';
}

export class CodeWordsGame extends DurableObject<Env> {
  private stateData?: GameState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const gameId = this.ctx.id.name ?? 'global-codewords-showdown';
      this.stateData = await loadGameState(this.ctx, gameId);
    });
  }

  private get state(): GameState {
    if (!this.stateData) {
      throw new Error('Game state has not been initialized.');
    }
    return this.stateData;
  }

  private async persist(): Promise<void> {
    await persistGameState(this.ctx, this.state);
  }

  private emitSnapshot(socket: WebSocket): void {
    const attachment = socket.deserializeAttachment() as ClientAttachment | null;
    const showKey = Boolean(attachment?.showKey);
    socket.send(encodeMessage({
      type: 'state-update',
      payload: getSpectatorProjection(this.state, showKey),
    }));
  }

  private broadcastSnapshots(): void {
    for (const socket of this.ctx.getWebSockets()) {
      this.emitSnapshot(socket);
    }
  }

  private queueTalonTurnTrigger(reason: string): void {
    const state = this.state;
    this.ctx.waitUntil(
      triggerTalonAgentForState(this.env, state, reason).catch((error) => {
        console.error('Failed to trigger Talon agent', error);
      }),
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('upgrade') !== 'websocket') {
        return new Response('Expected websocket upgrade', { status: 426 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.serializeAttachment({
        id: crypto.randomUUID(),
        showKey: url.searchParams.get('showKey') === 'true',
      } satisfies ClientAttachment);
      this.ctx.acceptWebSocket(server);
      this.emitSnapshot(server);
      return createWebSocketUpgradeResponse(client);
    }

    if (url.pathname === '/control' && request.method === 'POST') {
      const command = await request.json<InternalCommand>();
      try {
        const applied = applyInternalCommand(this.state, command);
        this.stateData = applied.state;
        if (applied.changed) {
          await this.persist();
          this.broadcastSnapshots();
          this.queueTalonTurnTrigger(command.type);
        } else if (command.type === 'trigger-current-agent') {
          this.queueTalonTurnTrigger('manual-trigger');
        }
        return jsonResponse(applied.result);
      } catch (error) {
        return jsonResponse(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 400 },
        );
      }
    }

    if (url.pathname === '/snapshot' && request.method === 'GET') {
      const showKey = url.searchParams.get('showKey') === 'true';
      return jsonResponse(getSpectatorProjection(this.state, showKey));
    }

    return new Response(`Not found for ${getGameIdFromRequest(request)}`, { status: 404 });
  }

  webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer): void {
    const messageText = typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage);
    const message = decodeMessage(messageText);
    if (!message) {
      socket.send(encodeMessage({ type: 'error', payload: { message: 'Unsupported websocket message.' } }));
      return;
    }

    if (message.type === 'subscribe') {
      const current = socket.deserializeAttachment() as ClientAttachment | null;
      socket.serializeAttachment({
        id: current?.id || crypto.randomUUID(),
        showKey: Boolean(message.showKey),
      } satisfies ClientAttachment);
      this.emitSnapshot(socket);
    }
  }
}
