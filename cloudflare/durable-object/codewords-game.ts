import { DurableObject } from 'cloudflare:workers';
import { getArenaStub, parseGameObjectName } from '../env';
import type { Env } from '../env';
import type { InternalCommand } from '../../interfaces/commands';
import type { AgentRef, AgentRole, GameState } from '../../interfaces/game';
import { getSpectatorProjection } from '../game/projections';
import { gameSummaryFromState } from '../arena/projections';
import { applyInternalCommand, recordCommandError } from './commands';
import {
  createWebSocketUpgradeResponse,
  decodeMessage,
  encodeMessage,
  jsonResponse,
  type ClientAttachment,
} from './socket-protocol';
import { loadGameState, persistGameState } from './repository';
import {
  getTalonAgentSessionStatus,
  resetTalonGameChannel,
  triggerTalonAgentForState,
  triggerTalonReviewerForState,
} from '../routes/talon';

function getGameIdFromRequest(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get('gameId') || url.hostname || 'main';
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

function activeTalonSessionMatchesTurn(state: GameState): boolean {
  const agent = currentAgentRef(state);
  const session = state.activeTalonSession;
  return Boolean(agent && session && session.team === agent.team && session.role === agent.role);
}

function sameAgent(left: AgentRef | undefined, right: AgentRef | undefined): boolean {
  return Boolean(left && right && left.team === right.team && left.role === right.role);
}

function commandAgent(command: InternalCommand): AgentRef | undefined {
  return 'agent' in command ? command.agent : undefined;
}

function sessionStatusLooksRunning(status: { state?: string; status?: string }): boolean | undefined {
  const value = (status.state ?? status.status ?? '').toLowerCase();
  if (!value) {
    return undefined;
  }
  if (['idle', 'complete', 'completed', 'failed', 'error', 'cancelled', 'canceled'].includes(value)) {
    return false;
  }
  if (
    value.includes('running')
    || value.includes('thinking')
    || value.includes('queued')
    || value.includes('pending')
    || value.includes('active')
    || value.includes('progress')
  ) {
    return true;
  }
  return undefined;
}

export class CodeWordsGame extends DurableObject<Env> {
  private stateData?: GameState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const { arenaId, gameId } = parseGameObjectName(this.ctx.id.name ?? 'main');
      this.stateData = await loadGameState(this.ctx, arenaId, gameId);
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

  private async notifyArena(): Promise<void> {
    await getArenaStub(this.env, this.state.arenaId).fetch('https://codewords.internal/internal/game-updated', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(gameSummaryFromState(this.state)),
    });
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

  private async triggerAndRecordTalonSession(state: GameState, reason: string): Promise<void> {
    const result = await triggerTalonAgentForState(this.env, state, reason);
    if (!result?.ok || !result.sessionId) {
      await this.scheduleTalonWatchdog();
      return;
    }

    const activeAgent = currentAgentRef(this.state);
    if (!activeAgent || activeAgent.team !== result.team || activeAgent.role !== result.role) {
      return;
    }

    const now = Date.now();
    const talonSession = {
      namespace: result.namespace,
      channel: result.channel,
      agent: result.agent,
      team: result.team,
      role: result.role,
      sessionId: result.sessionId,
      triggerMessageId: result.messageId,
      reason,
      triggeredAt: now,
    };
    const previousSessions = this.state.talonTriggerSessions ?? [];
    const talonTriggerSessions = previousSessions
      .filter((session) => {
        if (session.sessionId === talonSession.sessionId) {
          return false;
        }
        return !talonSession.triggerMessageId || session.triggerMessageId !== talonSession.triggerMessageId;
      })
      .concat(talonSession)
      .slice(-80);

    this.stateData = {
      ...this.state,
      activeTalonSession: talonSession,
      talonTriggerSessions,
      updatedAt: now,
    };
    await this.persist();
    await this.notifyArena();
    this.broadcastSnapshots();
    await this.scheduleTalonWatchdog();
  }

  private async triggerAndRecordReviewSession(state: GameState, reason: string): Promise<void> {
    if (this.state.review?.status === 'pending' || this.state.review?.status === 'complete') {
      return;
    }

    const result = await triggerTalonReviewerForState(this.env, state, reason);
    const now = Date.now();
    this.stateData = {
      ...this.state,
      review: {
        status: result?.ok ? 'pending' : 'failed',
        reviewer: result?.agent ?? 'codewords-reviewer',
        sessionId: result?.sessionId,
        triggerMessageId: result?.messageId,
        requestedAt: now,
        error: result?.ok ? undefined : result?.error ?? 'Reviewer trigger failed.',
      },
      updatedAt: now,
    };
    await this.persist();
    await this.notifyArena();
    this.broadcastSnapshots();
  }

  private queueTalonTurnTrigger(reason: string): void {
    const state = { ...this.state };
    this.ctx.waitUntil(
      this.triggerAndRecordTalonSession(state, reason).catch((error) => {
        console.error('Failed to trigger Talon agent', error);
      }),
    );
  }

  private queueReviewTrigger(reason: string): void {
    const state = { ...this.state };
    this.ctx.waitUntil(
      this.triggerAndRecordReviewSession(state, reason).catch((error) => {
        console.error('Failed to trigger Talon reviewer', error);
      }),
    );
  }

  private async scheduleTalonWatchdog(delayMs = 45000): Promise<void> {
    if (this.state.status !== 'active') {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + delayMs);
  }

  async alarm(): Promise<void> {
    if (this.state.status !== 'active') {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    if (activeTalonSessionMatchesTurn(this.state) && this.state.activeTalonSession) {
      const session = this.state.activeTalonSession;
      const ageMs = Date.now() - session.triggeredAt;
      const status = await getTalonAgentSessionStatus(this.env, session);
      const running = status.ok ? sessionStatusLooksRunning(status) : undefined;
      if (running === true || (running === undefined && ageMs < 90000)) {
        await this.scheduleTalonWatchdog(20000);
        return;
      }
      await this.triggerAndRecordTalonSession(this.state, 'session-idle-retry');
      return;
    }

    await this.triggerAndRecordTalonSession(this.state, 'watchdog-retry');
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
      const skipArenaNotify = request.headers.get('x-codewords-skip-arena-notify') === 'true';
      const skipTalonTrigger = request.headers.get('x-codewords-skip-talon-trigger') === 'true';
      const waitForTalonTrigger = request.headers.get('x-codewords-wait-for-talon-trigger') === 'true';
      const command = await request.json<InternalCommand>();
      try {
        const previousActiveAgent = currentAgentRef(this.state);
        const applied = applyInternalCommand(this.state, command);
        const triggerTalon = async (reason: string) => {
          if (waitForTalonTrigger) {
            await this.triggerAndRecordTalonSession(this.state, reason);
            return;
          }
          this.queueTalonTurnTrigger(reason);
        };

        if (applied.changed) {
          if (command.type === 'reset-game' && !skipTalonTrigger) {
            await resetTalonGameChannel(this.env, applied.state.arenaId, applied.state.gameId, applied.state.models);
          }
          this.stateData = applied.state;
          await this.persist();
          if (!skipArenaNotify) {
            await this.notifyArena();
          }
          this.broadcastSnapshots();
          const nextActiveAgent = currentAgentRef(this.state);
          const sameCommandAgentStillActive = sameAgent(commandAgent(command), nextActiveAgent)
            && sameAgent(previousActiveAgent, nextActiveAgent);
          if (this.state.status === 'finished') {
            this.queueReviewTrigger(command.type);
            await this.ctx.storage.deleteAlarm();
          } else if (!skipTalonTrigger) {
            if (sameCommandAgentStillActive && activeTalonSessionMatchesTurn(this.state)) {
              await this.scheduleTalonWatchdog(30000);
            } else {
              await triggerTalon(command.type);
            }
          } else {
            await this.scheduleTalonWatchdog();
          }
        } else if (command.type === 'trigger-current-agent') {
          if (activeTalonSessionMatchesTurn(this.state)) {
            await this.scheduleTalonWatchdog(15000);
          } else {
            await triggerTalon('manual-trigger');
          }
        }
        return jsonResponse(applied.result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const next = error instanceof Error ? recordCommandError(this.state, command, error) : undefined;
        if (next) {
          this.stateData = next;
          await this.persist();
          await this.notifyArena();
          this.broadcastSnapshots();
          await this.scheduleTalonWatchdog();
        }
        return jsonResponse(
          { error: message },
          { status: 400 },
        );
      }
    }

    if (url.pathname === '/summary' && request.method === 'GET') {
      return jsonResponse(gameSummaryFromState(this.state));
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
