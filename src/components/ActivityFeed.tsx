import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { useTalonChannelMessages, type ChannelMessage } from '@talonai/copilot';
import type { AgentRole, GameEvent, SpectatorProjection, TalonActiveSession, Team } from '@/interfaces/game';
import type { TalonChannelSession } from '@/src/client/codewordsClient';

type ActivityFeedProps = {
  game: SpectatorProjection;
  talonChannel?: TalonChannelSession;
  talonError?: string;
  talonSessionByTriggerMessageId: Map<string, TalonActiveSession>;
  onOpenTalonSession: (session: TalonActiveSession) => void;
};

type ActivityItem =
  | {
      id: string;
      kind: 'event';
      lane: string;
      label: string;
      timestamp: number;
      summary: string;
      event: GameEvent;
    }
  | {
      id: string;
      kind: 'message';
      lane: string;
      label: string;
      timestamp: number;
      summary: string;
      message: ChannelMessage;
    };

const ACTIVITY_SCROLL_LOAD_THRESHOLD_PX = 64;

function parseAgentName(agent: string): { team: Team; role: AgentRole } | undefined {
  const match = agent.match(/(?:^|.*-)(blue|red)-(spymaster|guesser)$/);
  if (!match) {
    return undefined;
  }
  return {
    team: match[1] as Team,
    role: match[2] as AgentRole,
  };
}

function normalizeEpochToMilliseconds(value: unknown): number | undefined {
  let normalized: number | undefined;
  if (typeof value === 'bigint') {
    const bigintValue = value < BigInt(0) ? -value : value;
    if (bigintValue > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    normalized = Number(value);
  } else if (typeof value === 'string') {
    const numericValue = Number(value);
    normalized = Number.isFinite(numericValue) ? numericValue : Date.parse(value);
  } else if (typeof value === 'number') {
    normalized = value;
  }
  if (typeof normalized !== 'number' || !Number.isFinite(normalized) || normalized <= 0) return undefined;
  if (normalized >= 1e15) return Math.trunc(normalized / 1000);
  if (normalized >= 1e12) return Math.trunc(normalized);
  if (normalized >= 1e9) return Math.trunc(normalized * 1000);
  return undefined;
}

function millisecondsFromUuidLike(id: unknown): number | undefined {
  if (typeof id !== 'string') return undefined;
  const compactHex = id.replace(/[^0-9a-fA-F]/g, '');
  if (compactHex.length >= 32 && compactHex.charAt(12) === '7') {
    const time = parseInt(compactHex.slice(0, 12), 16);
    return Number.isNaN(time) ? undefined : time;
  }
  return undefined;
}

function channelMessageTimestamp(message: ChannelMessage): number {
  return normalizeEpochToMilliseconds(message.createdAt ?? message.created_at)
    ?? millisecondsFromUuidLike(message.id)
    ?? 0;
}

function eventLane(event: GameEvent): { lane: string; label: string } {
  switch (event.type) {
    case 'game-reset':
    case 'game-finished':
    case 'game-reviewed':
      return { lane: 'system', label: 'System' };
    case 'clue-given':
      return { lane: 'clue', label: 'Clue' };
    case 'card-revealed':
      return { lane: 'guess', label: 'Guess' };
    case 'turn-passed':
      return { lane: 'pass', label: 'Pass' };
    case 'protocol-message':
      return { lane: 'protocol', label: 'Protocol' };
    case 'illegal-move':
      return { lane: 'illegal', label: 'Illegal' };
  }
}

function messageLane(message: ChannelMessage): { lane: string; label: string } {
  const authorKind = message.authorKind || message.author_kind || 'user';
  const author = message.author || '';
  if (authorKind === 'agent' || author.startsWith('agent:')) {
    return { lane: 'agent', label: 'Agent' };
  }
  if (authorKind === 'system' || author.startsWith('system:')) {
    return { lane: 'talon', label: 'Talon' };
  }
  return { lane: 'chat', label: 'Chat' };
}

function messageAuthor(message: ChannelMessage): string {
  const authorKind = message.authorKind || message.author_kind || 'user';
  return `${authorKind}:${message.author || 'unknown'}`;
}

function activityMessageKey(message: ChannelMessage, index: number): string {
  return message.id || `${message.createdAt ?? message.created_at ?? index}:${message.author || ''}:${message.content || ''}`;
}

export function ActivityFeed({
  game,
  talonChannel,
  talonError,
  talonSessionByTriggerMessageId,
  onOpenTalonSession,
}: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const skipNextAutoScrollRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const {
    messages,
    isLoading,
    isLoadingOlderMessages,
    hasMoreMessages,
    error,
    loadOlderMessages,
  } = useTalonChannelMessages({
    namespace: talonChannel?.namespace ?? '',
    channel: talonChannel?.channel ?? '',
    gatewayUrl: talonChannel?.talon.baseUrl ?? '',
    authToken: talonChannel ? `Bearer ${talonChannel.token}` : undefined,
    disabled: !talonChannel,
    messageLimit: 40,
    refreshIntervalMs: 1500,
  });

  const activity = useMemo<ActivityItem[]>(() => {
    const eventItems: ActivityItem[] = game.events
      .filter((event) => event.type !== 'game-reviewed')
      .map((event) => {
        const lane = eventLane(event);
        return {
          id: `event:${event.id}`,
          kind: 'event',
          lane: lane.lane,
          label: lane.label,
          timestamp: event.createdAt,
          summary: event.summary,
          event,
        };
      });
    const messageItems: ActivityItem[] = messages.map((message, index) => {
      const lane = messageLane(message);
      return {
        id: `message:${activityMessageKey(message, index)}`,
        kind: 'message',
        lane: lane.lane,
        label: lane.label,
        timestamp: channelMessageTimestamp(message),
        summary: message.content || '',
        message,
      };
    });
    return [...eventItems, ...messageItems]
      .sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
  }, [game.events, messages]);

  const filteredActivity = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return activity;
    }
    return activity.filter((item) => {
      const haystack = [
        item.label,
        item.summary,
        item.kind === 'message' ? messageAuthor(item.message) : '',
        item.kind === 'event' ? item.event.type : '',
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [activity, searchQuery]);

  useEffect(() => {
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      const container = scrollRef.current;
      if (!container) return;
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [filteredActivity.length, isLoading, error, talonError]);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (!hasMoreMessages || isLoadingOlderMessages) return;
    if (event.currentTarget.scrollTop > ACTIVITY_SCROLL_LOAD_THRESHOLD_PX) return;
    const container = event.currentTarget;
    const previousScrollHeight = container.scrollHeight;
    const previousScrollTop = container.scrollTop;
    skipNextAutoScrollRef.current = true;
    void loadOlderMessages().then(() => {
      window.requestAnimationFrame(() => {
        const nextContainer = scrollRef.current;
        if (!nextContainer) return;
        nextContainer.scrollTop = nextContainer.scrollHeight - previousScrollHeight + previousScrollTop;
      });
    });
  }, [hasMoreMessages, isLoadingOlderMessages, loadOlderMessages]);

  const openMessageSession = (message: ChannelMessage) => {
    const sourceAgent = message.sourceAgent || message.source_agent;
    const sourceSessionId = message.sourceSessionId || message.source_session_id;
    const triggerSession = message.id ? talonSessionByTriggerMessageId.get(message.id) : undefined;
    if (triggerSession) {
      onOpenTalonSession(triggerSession);
      return;
    }
    const sourceAgentRef = sourceAgent ? parseAgentName(sourceAgent) : undefined;
    if (!talonChannel || !sourceAgent || !sourceSessionId || !sourceAgentRef) return;
    onOpenTalonSession({
      namespace: talonChannel.namespace,
      channel: talonChannel.channel,
      agent: sourceAgent,
      team: sourceAgentRef.team,
      role: sourceAgentRef.role,
      sessionId: sourceSessionId,
      reason: 'channel-message',
      triggeredAt: Date.now(),
    });
  };

  return (
    <section className="log-panel activity-panel">
      <div className="panel-heading">
        <h2>Activity</h2>
        <div className="activity-heading-actions">
          <input
            className="activity-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            placeholder="Search activity"
            aria-label="Search activity"
          />
          <a
            className="powered-by-talon"
            href="https://github.com/impalasys/talon"
            target="_blank"
            rel="noreferrer"
          >
            <span>Powered by Talon</span>
            <span aria-hidden="true" className="external-link-icon">↗</span>
          </a>
        </div>
      </div>
      {talonError ? <div className="panel-error">{talonError}</div> : null}
      {error ? <div className="panel-error">{error}</div> : null}
      <div className="activity-feed" ref={scrollRef} onScroll={handleScroll}>
        {isLoadingOlderMessages ? <div className="channel-loading">Loading older Talon messages</div> : null}
        {isLoading ? <div className="channel-loading">Loading Talon messages</div> : null}
        {filteredActivity.length === 0 && !isLoading ? (
          <div className="channel-loading">{searchQuery.trim() ? 'No matching activity.' : 'No activity yet.'}</div>
        ) : (
          filteredActivity.map((item) => (
            <article className={`activity-item activity-${item.kind}`} key={item.id}>
              <div className="activity-meta">
                <span className={`lane-chip lane-${item.lane}`}>{item.label}</span>
                <time>{item.timestamp > 0 ? new Date(item.timestamp).toLocaleTimeString() : '-'}</time>
              </div>
              <div className="activity-body">
                {item.kind === 'message' ? (
                  <div className="activity-author">{messageAuthor(item.message)}</div>
                ) : null}
                <p>{item.summary}</p>
                {item.kind === 'message' && (
                  item.message.id && talonSessionByTriggerMessageId.has(item.message.id)
                  || item.message.sourceAgent
                  || item.message.source_agent
                ) ? (
                  <button
                    className="session-chip"
                    type="button"
                    onClick={() => openMessageSession(item.message)}
                  >
                    Thought process
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
