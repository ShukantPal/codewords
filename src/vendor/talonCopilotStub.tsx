import type { CSSProperties, ReactNode } from 'react';

export type ChannelMessage = {
  id?: string;
  author?: string;
  authorKind?: string;
  author_kind?: string;
  content?: string;
  sourceAgent?: string;
  source_agent?: string;
  sourceSessionId?: string;
  source_session_id?: string;
};

export type TalonChannelProps = {
  namespace: string;
  channel: string | { name?: string; status?: string };
  gatewayUrl: string;
  authToken?: string | null;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  disableUserInput?: boolean;
  author?: string;
  authorKind?: string;
  messageLimit?: number;
  refreshIntervalMs?: number | false;
  renderMessageActions?: (message: ChannelMessage) => ReactNode;
};

export function TalonChannel({ className, style }: TalonChannelProps) {
  return (
    <div className={className} style={style}>
      Talon channel viewer is available in local development when the Talon checkout is present.
    </div>
  );
}

export function TalonCopilot() {
  return null;
}

export function buildGatewayHeaders(authToken?: string | null) {
  return authToken ? { Authorization: authToken } : undefined;
}

export function normalizeGatewayUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

export function applyGatewayAuthorizationHeader(
  headerTarget: { set(name: string, value: string): void },
  authToken?: string | null,
) {
  if (authToken) {
    headerTarget.set('authorization', authToken);
  }
}
