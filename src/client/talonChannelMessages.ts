import { useCallback, useEffect, useRef, useState } from 'react';

export type TalonChannelMessage = {
  id?: string;
  ns?: string;
  channel?: string;
  authorKind?: string;
  author_kind?: string;
  author?: string;
  content?: string;
  createdAt?: bigint | number | string;
  created_at?: bigint | number | string;
  sourceAgent?: string;
  source_agent?: string;
  sourceSessionId?: string;
  source_session_id?: string;
};

type TalonChannelMessagesOptions = {
  namespace: string;
  channel: string;
  gatewayUrl: string;
  authToken?: string | null;
  disabled?: boolean;
  messageLimit?: number;
  refreshIntervalMs?: number | false;
};

type RefreshOptions = {
  silent?: boolean;
  replace?: boolean;
};

function normalizeGatewayUrl(gatewayUrl: string): string {
  return gatewayUrl.replace(/\/+$/, '');
}

function gatewayHeaders(authToken?: string | null, json = false): HeadersInit {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(authToken
      ? { Authorization: authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}` }
      : {}),
  };
}

function messagesUrl(
  gatewayUrl: string,
  namespace: string,
  channel: string,
  pageSize: number,
  beforeMessageId?: string,
): string {
  const url = new URL(
    `${normalizeGatewayUrl(gatewayUrl)}/v1/ns/${encodeURIComponent(namespace)}/channels/${encodeURIComponent(channel)}/messages`,
  );
  url.searchParams.set('page_size', String(Math.trunc(pageSize)));
  if (beforeMessageId) {
    url.searchParams.set('before_message_id', beforeMessageId);
  }
  return url.toString();
}

function normalizePage(response: unknown): {
  messages: TalonChannelMessage[];
  hasMore: boolean;
  nextBeforeMessageId: string | null;
} {
  const page = response as {
    messages?: unknown;
    hasMore?: unknown;
    has_more?: unknown;
    nextBeforeMessageId?: unknown;
    next_before_message_id?: unknown;
  };
  return {
    messages: Array.isArray(page.messages) ? page.messages as TalonChannelMessage[] : [],
    hasMore: Boolean(page.hasMore ?? page.has_more),
    nextBeforeMessageId: typeof page.nextBeforeMessageId === 'string'
      ? page.nextBeforeMessageId
      : typeof page.next_before_message_id === 'string'
        ? page.next_before_message_id
        : null,
  };
}

function normalizeEpochToMilliseconds(value: unknown): number | null {
  let normalized: number | null = null;
  if (typeof value === 'bigint') {
    const bigintValue = value < BigInt(0) ? -value : value;
    if (bigintValue > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    normalized = Number(value);
  } else if (typeof value === 'string') {
    const numericValue = Number(value);
    normalized = Number.isFinite(numericValue) ? numericValue : Date.parse(value);
  } else if (typeof value === 'number') {
    normalized = value;
  }
  if (typeof normalized !== 'number' || !Number.isFinite(normalized) || normalized <= 0) return null;
  if (normalized >= 1e15) return Math.trunc(normalized / 1000);
  if (normalized >= 1e12) return Math.trunc(normalized);
  if (normalized >= 1e9) return Math.trunc(normalized * 1000);
  return null;
}

function millisecondsFromUuidLike(id: unknown): number | null {
  if (typeof id !== 'string') return null;
  const compactHex = id.replace(/[^0-9a-fA-F]/g, '');
  if (compactHex.length >= 32 && compactHex.charAt(12) === '7') {
    const time = parseInt(compactHex.slice(0, 12), 16);
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

function channelMessageTimestamp(message: TalonChannelMessage): number | null {
  return normalizeEpochToMilliseconds(message.createdAt ?? message.created_at)
    ?? millisecondsFromUuidLike(message.id);
}

function channelMessageKey(message: TalonChannelMessage, fallbackIndex: number): string {
  return message.id || `${message.createdAt ?? message.created_at ?? fallbackIndex}:${message.author || ''}:${message.content || ''}`;
}

function compareMessages(left: TalonChannelMessage, right: TalonChannelMessage): number {
  const leftTimestamp = channelMessageTimestamp(left);
  const rightTimestamp = channelMessageTimestamp(right);
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }
  if (left.id && right.id && left.id !== right.id) {
    return left.id < right.id ? -1 : 1;
  }
  return 0;
}

function mergeMessages(
  existing: TalonChannelMessage[],
  incoming: TalonChannelMessage[],
): TalonChannelMessage[] {
  const byKey = new Map<string, TalonChannelMessage>();
  existing.forEach((message, index) => byKey.set(channelMessageKey(message, index), message));
  incoming.forEach((message, index) => byKey.set(channelMessageKey(message, existing.length + index), message));
  return Array.from(byKey.values()).sort(compareMessages);
}

export function useTalonChannelMessages({
  namespace,
  channel,
  gatewayUrl,
  authToken,
  disabled = false,
  messageLimit = 100,
  refreshIntervalMs = 2000,
}: TalonChannelMessagesOptions) {
  const [messages, setMessages] = useState<TalonChannelMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [nextBeforeMessageId, setNextBeforeMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingRefreshRef = useRef(false);
  const messagesRef = useRef<TalonChannelMessage[]>([]);
  const currentChannelRef = useRef({ namespace, channel });
  const isLoadingOlderMessagesRef = useRef(false);

  useEffect(() => {
    currentChannelRef.current = { namespace, channel };
  }, [namespace, channel]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const refresh = useCallback(async (options?: RefreshOptions) => {
    if (!namespace || !channel || disabled || pendingRefreshRef.current) return;
    const requestNamespace = namespace;
    const requestChannel = channel;
    pendingRefreshRef.current = true;
    if (!options?.silent) setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        messagesUrl(gatewayUrl, requestNamespace, requestChannel, messageLimit),
        { headers: gatewayHeaders(authToken) },
      );
      if (!response.ok) throw new Error(`Messages HTTP ${response.status}`);
      const page = normalizePage(await response.json());
      if (
        requestNamespace !== currentChannelRef.current.namespace ||
        requestChannel !== currentChannelRef.current.channel
      ) {
        return;
      }
      const newestKeys = new Set(page.messages.map((message, index) => channelMessageKey(message, index)));
      const oldestNewestMessage = page.messages[0];
      const oldestNewestTimestamp = oldestNewestMessage ? channelMessageTimestamp(oldestNewestMessage) : null;
      const hasLoadedOlderMessages = messagesRef.current.some((message, index) => {
        const key = channelMessageKey(message, index);
        if (newestKeys.has(key)) return false;
        const timestamp = channelMessageTimestamp(message);
        if (timestamp !== null && oldestNewestTimestamp !== null) return timestamp < oldestNewestTimestamp;
        return Boolean(message.id && oldestNewestMessage?.id && message.id < oldestNewestMessage.id);
      });

      setMessages((existing) => options?.replace ? page.messages : mergeMessages(existing, page.messages));
      if (options?.replace || !hasLoadedOlderMessages) {
        setHasMoreMessages(page.hasMore);
        setNextBeforeMessageId(page.nextBeforeMessageId);
      }
    } catch (err) {
      if (
        requestNamespace === currentChannelRef.current.namespace &&
        requestChannel === currentChannelRef.current.channel
      ) {
        setError(err instanceof Error ? err.message : 'Failed to load channel messages');
      }
    } finally {
      if (
        requestNamespace === currentChannelRef.current.namespace &&
        requestChannel === currentChannelRef.current.channel
      ) {
        pendingRefreshRef.current = false;
        if (!options?.silent) setIsLoading(false);
      }
    }
  }, [authToken, channel, disabled, gatewayUrl, messageLimit, namespace]);

  useEffect(() => {
    pendingRefreshRef.current = false;
    setMessages([]);
    messagesRef.current = [];
    setHasMoreMessages(false);
    setNextBeforeMessageId(null);
    setIsLoading(false);
    setError(null);
    isLoadingOlderMessagesRef.current = false;
    void refresh({ replace: true });
  }, [namespace, channel, refresh]);

  useEffect(() => {
    if (refreshIntervalMs === false || disabled || !namespace || !channel) return;
    const timer = window.setInterval(() => {
      void refresh({ silent: true });
    }, Math.max(750, Math.trunc(refreshIntervalMs)));
    return () => window.clearInterval(timer);
  }, [channel, disabled, namespace, refresh, refreshIntervalMs]);

  const loadOlderMessages = useCallback(async () => {
    if (
      !namespace ||
      !channel ||
      disabled ||
      !hasMoreMessages ||
      !nextBeforeMessageId ||
      isLoadingOlderMessagesRef.current
    ) {
      return;
    }

    const requestNamespace = namespace;
    const requestChannel = channel;
    isLoadingOlderMessagesRef.current = true;
    setIsLoadingOlderMessages(true);
    setError(null);
    try {
      const response = await fetch(
        messagesUrl(gatewayUrl, requestNamespace, requestChannel, messageLimit, nextBeforeMessageId),
        { headers: gatewayHeaders(authToken) },
      );
      if (!response.ok) throw new Error(`Messages HTTP ${response.status}`);
      const page = normalizePage(await response.json());
      if (
        requestNamespace !== currentChannelRef.current.namespace ||
        requestChannel !== currentChannelRef.current.channel
      ) {
        return;
      }
      setMessages((existing) => mergeMessages(existing, page.messages));
      setHasMoreMessages(page.hasMore);
      setNextBeforeMessageId(page.nextBeforeMessageId);
    } catch (err) {
      if (
        requestNamespace === currentChannelRef.current.namespace &&
        requestChannel === currentChannelRef.current.channel
      ) {
        setError(err instanceof Error ? err.message : 'Failed to load older channel messages');
      }
    } finally {
      if (
        requestNamespace === currentChannelRef.current.namespace &&
        requestChannel === currentChannelRef.current.channel
      ) {
        isLoadingOlderMessagesRef.current = false;
        setIsLoadingOlderMessages(false);
      }
    }
  }, [authToken, channel, disabled, gatewayUrl, hasMoreMessages, messageLimit, namespace, nextBeforeMessageId]);

  return {
    messages,
    isLoading,
    isLoadingOlderMessages,
    hasMoreMessages,
    error,
    refresh,
    loadOlderMessages,
  };
}
