import type { AgentRole, Team } from '../../interfaces/game';
import type { GameState } from '../../interfaces/game';
import type { Env } from '../env';
import { getTalonApiBaseUrl, getTalonNamespace } from '../env';
import { jsonResponse } from '../durable-object/socket-protocol';

const TOKEN_TTL_SECONDS = 60 * 15;
const TALON_AUDIENCE = 'talon';
const TALON_CHANNEL = 'match';

type TalonSetupResult = {
  namespace: string;
  channel: string;
  agents: string[];
  subscriptions: string[];
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

type TalonTriggerResult = {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  agent: string;
  namespace: string;
  channel: string;
  error?: string;
};

const TALON_AGENT_REFS: Array<{ team: Team; role: AgentRole; name: string; systemPrompt: string }> = [
  {
    team: 'blue',
    role: 'spymaster',
    name: 'blue-spymaster',
    systemPrompt: 'You are the blue spymaster in a CodeWords match. Give legal concise clues for the blue guesser. Do not reveal the hidden board key publicly.',
  },
  {
    team: 'blue',
    role: 'guesser',
    name: 'blue-guesser',
    systemPrompt: 'You are the blue guesser in a CodeWords match. Interpret blue spymaster clues, make guesses for blue words, and pass when risk is too high.',
  },
  {
    team: 'red',
    role: 'spymaster',
    name: 'red-spymaster',
    systemPrompt: 'You are the red spymaster in a CodeWords match. Give legal concise clues for the red guesser. Do not reveal the hidden board key publicly.',
  },
  {
    team: 'red',
    role: 'guesser',
    name: 'red-guesser',
    systemPrompt: 'You are the red guesser in a CodeWords match. Interpret red spymaster clues, make guesses for red words, and pass when risk is too high.',
  },
];

export function matchTalonPath(pathname: string): { gameId: string; team: Team; role: AgentRole } | undefined {
  const match = pathname.match(/^\/talon\/games\/([^/]+)\/(blue|red)\/(spymaster|guesser)\/session-token$/);
  if (!match) {
    return undefined;
  }
  return {
    gameId: decodeURIComponent(match[1]),
    team: match[2] as Team,
    role: match[3] as AgentRole,
  };
}

export function matchTalonChannelPath(pathname: string): { gameId: string } | undefined {
  const match = pathname.match(/^\/talon\/games\/([^/]+)\/channel-token$/);
  if (!match) {
    return undefined;
  }
  return { gameId: decodeURIComponent(match[1]) };
}

function base64UrlEncode(bytes: ArrayBuffer | string): string {
  const binary = typeof bytes === 'string'
    ? bytes
    : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function mintSessionToken(env: Env, payload: Record<string, unknown>): Promise<string> {
  const secret = env.TALON_JWT_SECRET?.trim() || env.GATEWAY_JWT_SECRET?.trim();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims = {
    ...payload,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  };

  if (!secret) {
    return base64UrlEncode(JSON.stringify(claims));
  }

  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(claims));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${base64UrlEncode(signature)}`;
}

function getTalonBearerToken(env: Env): string | undefined {
  return env.TALON_API_TOKEN?.trim() || env.TALON_JWT_SECRET?.trim();
}

async function talonRequest(env: Env, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const baseUrl = getTalonApiBaseUrl(env).replace(/\/$/, '');
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
}

async function ensureTalonGameChannel(env: Env, gameId: string, namespace: string): Promise<TalonSetupResult> {
  const token = getTalonBearerToken(env);
  if (!token || env.TALON_BOOTSTRAP_DISABLED === 'true') {
    const agentNames = TALON_AGENT_REFS.map((agent) => agent.name);
    return { namespace, channel: TALON_CHANNEL, agents: agentNames, subscriptions: agentNames, ok: false, skipped: true };
  }

  const encodedNamespace = encodeURIComponent(namespace);
  const namespacePath = `/v1/namespaces/${encodedNamespace}`;
  const namespaceResponse = await talonRequest(env, token, namespacePath);
  if (namespaceResponse.status === 404) {
    const createNamespaceResponse = await talonRequest(env, token, namespacePath, {
      method: 'POST',
      body: JSON.stringify({
        name: namespace,
        recursive: true,
        labels: { app: 'codewords', gameId },
      }),
    });
    if (!createNamespaceResponse.ok) {
      return {
        namespace,
        channel: TALON_CHANNEL,
        agents: TALON_AGENT_REFS.map((agent) => agent.name),
        subscriptions: [],
        ok: false,
        error: `create namespace failed: ${createNamespaceResponse.status}`,
      };
    }
  } else if (!namespaceResponse.ok) {
    return {
      namespace,
      channel: TALON_CHANNEL,
      agents: TALON_AGENT_REFS.map((agent) => agent.name),
      subscriptions: [],
      ok: false,
      error: `get namespace failed: ${namespaceResponse.status}`,
    };
  }

  const agents: string[] = [];
  for (const agent of TALON_AGENT_REFS) {
    const agentPath = `/v1/ns/${encodedNamespace}/agents/${encodeURIComponent(agent.name)}`;
    const agentResponse = await talonRequest(env, token, agentPath);
    if (agentResponse.status === 404) {
      const createAgentResponse = await talonRequest(env, token, `/v1/ns/${encodedNamespace}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          name: agent.name,
          definition: {
            customSpec: {
              systemPrompt: agent.systemPrompt,
              modelPolicy: {
                profiles: [
                  {
                    name: 'default',
                    model: {
                      provider: 'openai',
                      name: 'gpt-5.4-nano',
                      temperature: 0,
                    },
                  },
                ],
              },
            },
          },
          labels: {
            app: 'codewords',
            gameId,
            team: agent.team,
            role: agent.role,
          },
        }),
      });
      if (!createAgentResponse.ok) {
        return {
          namespace,
          channel: TALON_CHANNEL,
          agents,
          subscriptions: [],
          ok: false,
          error: `create agent ${agent.name} failed: ${createAgentResponse.status}`,
        };
      }
    } else if (!agentResponse.ok) {
      return {
        namespace,
        channel: TALON_CHANNEL,
        agents,
        subscriptions: [],
        ok: false,
        error: `get agent ${agent.name} failed: ${agentResponse.status}`,
      };
    }
    agents.push(agent.name);
  }

  const channelPath = `/v1/ns/${encodedNamespace}/channels/${encodeURIComponent(TALON_CHANNEL)}`;
  const channelResponse = await talonRequest(env, token, channelPath);
  if (channelResponse.status === 404) {
    const createChannelResponse = await talonRequest(env, token, `/v1/ns/${encodedNamespace}/channels`, {
      method: 'POST',
      body: JSON.stringify({
        channel: {
          name: TALON_CHANNEL,
          ns: namespace,
          title: 'CodeWords Match',
          status: 'open',
          metadata: { gameId },
          labels: { app: 'codewords', gameId },
        },
      }),
    });
    if (!createChannelResponse.ok) {
      return {
        namespace,
        channel: TALON_CHANNEL,
        agents,
        subscriptions: [],
        ok: false,
        error: `create channel failed: ${createChannelResponse.status}`,
      };
    }
  } else if (!channelResponse.ok) {
    return {
      namespace,
      channel: TALON_CHANNEL,
      agents,
      subscriptions: [],
      ok: false,
      error: `get channel failed: ${channelResponse.status}`,
    };
  }

  const subscriptions: string[] = [];
  for (const agent of TALON_AGENT_REFS) {
    const subscriptionPath = `/v1/ns/${encodedNamespace}/channels/${encodeURIComponent(TALON_CHANNEL)}/subscriptions/${encodeURIComponent(agent.name)}`;
    const subscriptionResponse = await talonRequest(env, token, subscriptionPath);
    if (subscriptionResponse.status === 404) {
      const createSubscriptionResponse = await talonRequest(
        env,
        token,
        `/v1/ns/${encodedNamespace}/channels/${encodeURIComponent(TALON_CHANNEL)}/subscriptions`,
        {
          method: 'POST',
          body: JSON.stringify({
            subscription: {
              name: agent.name,
              ns: namespace,
              channel: TALON_CHANNEL,
              agent: agent.name,
              enabled: true,
              trigger: 'manual',
              contextPolicy: {
                mode: 'recent_public',
                maxMessages: 20,
              },
              labels: {
                app: 'codewords',
                gameId,
                team: agent.team,
                role: agent.role,
              },
            },
          }),
        },
      );
      if (!createSubscriptionResponse.ok) {
        return {
          namespace,
          channel: TALON_CHANNEL,
          agents,
          subscriptions,
          ok: false,
          error: `create subscription ${agent.name} failed: ${createSubscriptionResponse.status}`,
        };
      }
    } else if (!subscriptionResponse.ok) {
      return {
        namespace,
        channel: TALON_CHANNEL,
        agents,
        subscriptions,
        ok: false,
        error: `get subscription ${agent.name} failed: ${subscriptionResponse.status}`,
      };
    }
    subscriptions.push(agent.name);
  }

  return { namespace, channel: TALON_CHANNEL, agents, subscriptions, ok: true };
}

function currentAgentForState(state: GameState): { team: Team; role: AgentRole; name: string } | undefined {
  if (state.status !== 'active') {
    return undefined;
  }
  const role: AgentRole = state.turn.phase === 'clue' ? 'spymaster' : 'guesser';
  return {
    team: state.turn.team,
    role,
    name: `${state.turn.team}-${role}`,
  };
}

function buildTurnTriggerMessage(state: GameState, agent: { team: Team; role: AgentRole; name: string }, reason: string): string {
  const clue = state.turn.clue
    ? ` Current clue: ${state.turn.clue.word} ${state.turn.clue.count}. Guesses remaining: ${state.turn.guessesRemaining}.`
    : '';
  return [
    `CodeWords turn trigger for ${agent.name}.`,
    `Game: ${state.gameId}.`,
    `Reason: ${reason}.`,
    `It is ${agent.team}'s ${state.turn.phase} phase.${clue}`,
    'Use your CodeWords MCP tools to inspect your authorized game state and make exactly one legal next move.',
  ].join(' ');
}

export async function triggerTalonAgentForState(
  env: Env,
  state: GameState,
  reason: string,
): Promise<TalonTriggerResult | undefined> {
  const agent = currentAgentForState(state);
  if (!agent) {
    return undefined;
  }

  const token = getTalonBearerToken(env);
  const namespace = getTalonNamespace(env, state.gameId);
  if (!token || env.TALON_BOOTSTRAP_DISABLED === 'true') {
    return {
      ok: false,
      skipped: true,
      agent: agent.name,
      namespace,
      channel: TALON_CHANNEL,
    };
  }

  const setup = await ensureTalonGameChannel(env, state.gameId, namespace);
  if (!setup.ok) {
    return {
      ok: false,
      agent: agent.name,
      namespace,
      channel: TALON_CHANNEL,
      error: setup.error ?? 'Talon setup failed.',
    };
  }

  const response = await talonRequest(
    env,
    token,
    `/v1/ns/${encodeURIComponent(namespace)}/channels/${encodeURIComponent(TALON_CHANNEL)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        authorKind: 'system',
        author: 'codewords',
        content: buildTurnTriggerMessage(state, agent, reason),
        subscriptionNames: [agent.name],
        labels: {
          app: 'codewords',
          gameId: state.gameId,
          team: agent.team,
          role: agent.role,
          reason,
        },
      }),
    },
  );

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      agent: agent.name,
      namespace,
      channel: TALON_CHANNEL,
      error: `post channel message failed: ${response.status}`,
    };
  }

  return {
    ok: true,
    status: response.status,
    agent: agent.name,
    namespace,
    channel: TALON_CHANNEL,
  };
}

export function handleTalonOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
  });
}

export async function handleTalonSessionToken(
  request: Request,
  env: Env,
  gameId: string,
  team: Team,
  role: AgentRole,
): Promise<Response> {
  const url = new URL(request.url);
  const namespace = getTalonNamespace(env, gameId);
  const agent = `${team}-${role}`;
  const sessionId = `${gameId}-${agent}`;
  const mcpUrl = new URL(`/mcp/games/${encodeURIComponent(gameId)}/${team}/${role}`, url.origin).toString();
  const talonSetup = await ensureTalonGameChannel(env, gameId, namespace);
  const channelToken = await mintSessionToken(env, {
    sub: `codewords:${gameId}:channel:${TALON_CHANNEL}`,
    aud: TALON_AUDIENCE,
    'talon:ns': namespace,
    'talon:channel': TALON_CHANNEL,
    gameId,
    channel: TALON_CHANNEL,
  });
  const token = await mintSessionToken(env, {
    sub: `codewords:${gameId}:${agent}`,
    aud: TALON_AUDIENCE,
    'talon:ns': namespace,
    'talon:agent': agent,
    gameId,
    team,
    role,
  });

  return jsonResponse(
    {
      gameId,
      team,
      role,
      token,
      agentToken: token,
      channelToken,
      namespace,
      channel: TALON_CHANNEL,
      agent,
      sessionId,
      expiresInSeconds: TOKEN_TTL_SECONDS,
      mcpUrl,
      talon: {
        baseUrl: getTalonApiBaseUrl(env),
        setup: talonSetup,
        channelStreamUrl: `${getTalonApiBaseUrl(env).replace(/\/$/, '')}/v1/ns/${encodeURIComponent(namespace)}/channels/${encodeURIComponent(TALON_CHANNEL)}/stream`,
      },
    },
    {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    },
  );
}

export async function handleTalonChannelToken(request: Request, env: Env, gameId: string): Promise<Response> {
  const namespace = getTalonNamespace(env, gameId);
  const talonSetup = await ensureTalonGameChannel(env, gameId, namespace);
  const token = await mintSessionToken(env, {
    sub: `codewords:${gameId}:channel:${TALON_CHANNEL}`,
    aud: TALON_AUDIENCE,
    'talon:ns': namespace,
    'talon:channel': TALON_CHANNEL,
    gameId,
    channel: TALON_CHANNEL,
  });
  const baseUrl = getTalonApiBaseUrl(env).replace(/\/$/, '');

  return jsonResponse(
    {
      gameId,
      namespace,
      channel: TALON_CHANNEL,
      token,
      expiresInSeconds: TOKEN_TTL_SECONDS,
      talon: {
        baseUrl,
        setup: talonSetup,
        channelStreamUrl: `${baseUrl}/v1/ns/${encodeURIComponent(namespace)}/channels/${encodeURIComponent(TALON_CHANNEL)}/stream`,
        channelMessagesUrl: `${baseUrl}/v1/ns/${encodeURIComponent(namespace)}/channels/${encodeURIComponent(TALON_CHANNEL)}/messages`,
      },
    },
    {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    },
  );
}
