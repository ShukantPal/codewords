import type { AgentRole, Team } from "../../interfaces/game";
import type { GameState } from "../../interfaces/game";
import type { Env } from "../env";
import { getCodeWordsPublicUrl, getTalonApiBaseUrl, getTalonNamespace } from "../env";
import { jsonResponse } from "../durable-object/socket-protocol";

const TOKEN_TTL_SECONDS = 60 * 15;
const TALON_AUDIENCE = "talon";
const TALON_CHANNEL = "match";
const CODEWORDS_MCP_SERVER = "codewords";
const CODEWORDS_MCP_AUDIENCE = "codewords-mcp";
const TALON_MCP_AUTH_BROKER_AUDIENCE = "conic-mcp-auth-broker";
const ACCEPTED_MCP_AUTH_BROKER_REQUEST_AUDIENCES = new Set([
  CODEWORDS_MCP_SERVER,
  TALON_MCP_AUTH_BROKER_AUDIENCE,
]);

type TalonSetupResult = {
  namespace: string;
  channel: string;
  agents: string[];
  subscriptions: string[];
  mcpServer?: string;
  mcpBinding?: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

export type TalonTriggerResult = {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  agent: string;
  team: Team;
  role: AgentRole;
  namespace: string;
  channel: string;
  messageId?: string;
  sessionId?: string;
  error?: string;
};

export type TalonChannelResetResult = {
  namespace: string;
  channel: string;
  deletedSubscriptions: string[];
  deletedChannel: boolean;
  setup?: TalonSetupResult;
  ok: boolean;
  skipped?: boolean;
};

type PostChannelMessageResponse = {
  message?: {
    id?: string;
  };
  routed_sessions?: Array<{
    subscription?: string;
    agent?: string;
    session_id?: string;
    error?: string;
  }>;
  routedSessions?: Array<{
    subscription?: string;
    agent?: string;
    sessionId?: string;
    error?: string;
  }>;
};

function routedSessionId(
  session: NonNullable<PostChannelMessageResponse["routed_sessions"]>[number]
    | NonNullable<PostChannelMessageResponse["routedSessions"]>[number]
    | undefined,
): string | undefined {
  if (!session) {
    return undefined;
  }
  const normalized = session as { session_id?: string; sessionId?: string };
  return normalized.session_id ?? normalized.sessionId;
}

const TALON_AGENT_REFS: Array<{
  team: Team;
  role: AgentRole;
  name: string;
  systemPrompt: string;
}> = [
  {
    team: "blue",
    role: "spymaster",
    name: "blue-spymaster",
    systemPrompt:
      "You are the blue spymaster in a CodeWords match. Give legal concise clues for the blue guesser. Do not reveal the hidden board key publicly.",
  },
  {
    team: "blue",
    role: "guesser",
    name: "blue-guesser",
    systemPrompt:
      "You are the blue guesser in a CodeWords match. Interpret blue spymaster clues, make guesses for blue words, and pass when risk is too high.",
  },
  {
    team: "red",
    role: "spymaster",
    name: "red-spymaster",
    systemPrompt:
      "You are the red spymaster in a CodeWords match. Give legal concise clues for the red guesser. Do not reveal the hidden board key publicly.",
  },
  {
    team: "red",
    role: "guesser",
    name: "red-guesser",
    systemPrompt:
      "You are the red guesser in a CodeWords match. Interpret red spymaster clues, make guesses for red words, and pass when risk is too high.",
  },
];

export function matchTalonPath(
  pathname: string,
): { gameId: string; team: Team; role: AgentRole } | undefined {
  const match = pathname.match(
    /^\/talon\/games\/([^/]+)\/(blue|red)\/(spymaster|guesser)\/session-token$/,
  );
  if (!match) {
    return undefined;
  }
  return {
    gameId: decodeURIComponent(match[1]),
    team: match[2] as Team,
    role: match[3] as AgentRole,
  };
}

export function matchTalonChannelPath(
  pathname: string,
): { gameId: string } | undefined {
  const match = pathname.match(/^\/talon\/games\/([^/]+)\/channel-token$/);
  if (!match) {
    return undefined;
  }
  return { gameId: decodeURIComponent(match[1]) };
}

export function matchTalonMcpAuthPath(pathname: string): boolean {
  return pathname === "/talon/mcp-auth";
}

function base64UrlEncode(bytes: ArrayBuffer | string): string {
  const binary =
    typeof bytes === "string"
      ? bytes
      : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function mintSessionToken(
  env: Env,
  payload: Record<string, unknown>,
): Promise<string> {
  const secret = env.TALON_JWT_SECRET?.trim();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims = {
    ...payload,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_TTL_SECONDS,
  };

  if (!secret) {
    return base64UrlEncode(JSON.stringify(claims));
  }

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(claims));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${body}`),
  );
  return `${header}.${body}.${base64UrlEncode(signature)}`;
}

function base64UrlDecodeToBuffer(value: string): ArrayBuffer {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

async function verifySessionToken(env: Env, token: string, audience: string): Promise<Record<string, unknown>> {
  const secret = env.TALON_JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("TALON_JWT_SECRET is not configured.");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Expected a signed JWT.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecodeToBuffer(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) {
    throw new Error("Invalid token signature.");
  }
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBuffer(parts[1]))) as Record<string, unknown>;
  if (claims.aud !== audience) {
    throw new Error("Invalid token audience.");
  }
  if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error("Token is expired.");
  }
  return claims;
}

async function mintTalonBearerToken(env: Env): Promise<string | undefined> {
  if (!env.TALON_JWT_SECRET?.trim()) {
    return undefined;
  }

  return mintSessionToken(env, {
    sub: "codewords-worker",
    aud: TALON_AUDIENCE,
  });
}

async function talonRequest(
  env: Env,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const baseUrl = getTalonApiBaseUrl(env).replace(/\/$/, "");
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function codeWordsMcpAllowedTools(): string[] {
  return [
    "get_board",
    "get_turn",
    "send_protocol_message",
    "read_protocol_messages",
    "give_clue",
    "make_guess",
    "pass_turn",
  ];
}

async function ensureCodeWordsMcpServer(env: Env, token: string): Promise<void> {
  const publicUrl = getCodeWordsPublicUrl(env).replace(/\/$/, "");
  const response = await talonRequest(env, token, "/v1/mcp-servers", {
    method: "POST",
    body: JSON.stringify({
      server: {
        apiVersion: "talon.impalasys.com/v1",
        kind: "McpServer",
        metadata: {
          name: CODEWORDS_MCP_SERVER,
        },
        spec: {
          transport: "http",
          target: `${publicUrl}/mcp/codewords`,
          args: [],
          headers: {},
          disabled: false,
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`create MCP server failed: ${response.status}`);
  }
}

async function ensureCodeWordsMcpBinding(env: Env, token: string, namespace: string): Promise<void> {
  const publicUrl = getCodeWordsPublicUrl(env).replace(/\/$/, "");
  const response = await talonRequest(env, token, `/v1/namespaces/${encodeURIComponent(namespace)}/mcp-bindings`, {
    method: "POST",
    body: JSON.stringify({
      ns: namespace,
      binding: {
        apiVersion: "talon.impalasys.com/v1",
        kind: "McpServerBinding",
        metadata: {
          name: CODEWORDS_MCP_SERVER,
          namespace,
        },
        spec: {
          serverRef: CODEWORDS_MCP_SERVER,
          args: [],
          headers: {},
          disabled: false,
          authBroker: {
            kind: "http_bearer",
            url: `${publicUrl}/talon/mcp-auth`,
            cacheTtlSeconds: 60,
            audience: TALON_MCP_AUTH_BROKER_AUDIENCE,
          },
          allowedToolNames: codeWordsMcpAllowedTools(),
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`create MCP binding failed: ${response.status}`);
  }
}

async function ensureTalonGameChannel(
  env: Env,
  gameId: string,
  namespace: string,
): Promise<TalonSetupResult> {
  const token = await mintTalonBearerToken(env);
  if (!token || env.TALON_BOOTSTRAP_DISABLED === "true") {
    const agentNames = TALON_AGENT_REFS.map((agent) => agent.name);
    return {
      namespace,
      channel: TALON_CHANNEL,
      agents: agentNames,
      subscriptions: agentNames,
      ok: false,
      skipped: true,
    };
  }

  const encodedNamespace = encodeURIComponent(namespace);
  const namespacePath = `/v1/namespaces/${encodedNamespace}`;
  const namespaceResponse = await talonRequest(env, token, namespacePath);
  if (namespaceResponse.status === 404) {
    const createNamespaceResponse = await talonRequest(
      env,
      token,
      namespacePath,
      {
        method: "POST",
        body: JSON.stringify({
          name: namespace,
          recursive: true,
          labels: { app: "codewords", gameId },
        }),
      },
    );
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

  try {
    await ensureCodeWordsMcpServer(env, token);
    await ensureCodeWordsMcpBinding(env, token, namespace);
  } catch (error) {
    return {
      namespace,
      channel: TALON_CHANNEL,
      agents: TALON_AGENT_REFS.map((agent) => agent.name),
      subscriptions: [],
      mcpServer: CODEWORDS_MCP_SERVER,
      mcpBinding: CODEWORDS_MCP_SERVER,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const agents: string[] = [];
  for (const agent of TALON_AGENT_REFS) {
    const agentPath = `/v1/ns/${encodedNamespace}/agents/${encodeURIComponent(agent.name)}`;
    const agentResponse = await talonRequest(env, token, agentPath);
    const agentDefinition = {
      customSpec: {
        systemPrompt: agent.systemPrompt,
        modelPolicy: {
          profiles: [
            {
              name: "default",
              model: {
                provider: "novita",
                name: "minimax/minimax-m2.7",
                temperature: 1,
              },
            },
          ],
        },
        mcpServerRefs: [CODEWORDS_MCP_SERVER],
      },
    };
    if (agentResponse.status === 404) {
      const createAgentResponse = await talonRequest(
        env,
        token,
        `/v1/ns/${encodedNamespace}/agents`,
        {
          method: "POST",
          body: JSON.stringify({
            name: agent.name,
            definition: agentDefinition,
            labels: {
              app: "codewords",
              gameId,
              team: agent.team,
              role: agent.role,
            },
          }),
        },
      );
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
    } else {
      const updateAgentResponse = await talonRequest(
        env,
        token,
        agentPath,
        {
          method: "PUT",
          body: JSON.stringify({
            definition: agentDefinition,
            labels: {
              app: "codewords",
              gameId,
              team: agent.team,
              role: agent.role,
            },
          }),
        },
      );
      if (!updateAgentResponse.ok) {
        return {
          namespace,
          channel: TALON_CHANNEL,
          agents,
          subscriptions: [],
          mcpServer: CODEWORDS_MCP_SERVER,
          mcpBinding: CODEWORDS_MCP_SERVER,
          ok: false,
          error: `update agent ${agent.name} failed: ${updateAgentResponse.status}`,
        };
      }
    }
    agents.push(agent.name);
  }

  const channelPath = `/v1/ns/${encodedNamespace}/channels/${encodeURIComponent(TALON_CHANNEL)}`;
  const channelResponse = await talonRequest(env, token, channelPath);
  if (channelResponse.status === 404) {
    const createChannelResponse = await talonRequest(
      env,
      token,
      `/v1/ns/${encodedNamespace}/channels`,
      {
        method: "POST",
        body: JSON.stringify({
          channel: {
            name: TALON_CHANNEL,
            ns: namespace,
            title: "CodeWords Match",
            status: "open",
            metadata: { gameId },
            labels: { app: "codewords", gameId },
          },
        }),
      },
    );
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
    const subscriptionResponse = await talonRequest(
      env,
      token,
      subscriptionPath,
    );
    if (subscriptionResponse.status === 404) {
      const createSubscriptionResponse = await talonRequest(
        env,
        token,
        `/v1/ns/${encodedNamespace}/channels/${encodeURIComponent(TALON_CHANNEL)}/subscriptions`,
        {
          method: "POST",
          body: JSON.stringify({
            subscription: {
              name: agent.name,
              ns: namespace,
              channel: TALON_CHANNEL,
              agent: agent.name,
              enabled: true,
              trigger: "manual",
              contextPolicy: {
                mode: "recent_public",
                maxMessages: 20,
              },
              labels: {
                app: "codewords",
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

  return {
    namespace,
    channel: TALON_CHANNEL,
    agents,
    subscriptions,
    mcpServer: CODEWORDS_MCP_SERVER,
    mcpBinding: CODEWORDS_MCP_SERVER,
    ok: true,
  };
}

async function deleteTalonResource(env: Env, token: string, path: string): Promise<boolean> {
  const response = await talonRequest(env, token, path, { method: "DELETE" });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`delete ${path} failed: ${response.status}`);
  }
  return true;
}

export async function resetTalonGameChannel(env: Env, gameId: string): Promise<TalonChannelResetResult> {
  const namespace = getTalonNamespace(env, gameId);
  const token = await mintTalonBearerToken(env);
  if (!token || env.TALON_BOOTSTRAP_DISABLED === "true") {
    return {
      namespace,
      channel: TALON_CHANNEL,
      deletedSubscriptions: [],
      deletedChannel: false,
      ok: false,
      skipped: true,
    };
  }

  const encodedNamespace = encodeURIComponent(namespace);
  const encodedChannel = encodeURIComponent(TALON_CHANNEL);
  const deletedSubscriptions: string[] = [];
  for (const agent of TALON_AGENT_REFS) {
    const deleted = await deleteTalonResource(
      env,
      token,
      `/v1/ns/${encodedNamespace}/channels/${encodedChannel}/subscriptions/${encodeURIComponent(agent.name)}`,
    );
    if (deleted) {
      deletedSubscriptions.push(agent.name);
    }
  }

  const deletedChannel = await deleteTalonResource(
    env,
    token,
    `/v1/ns/${encodedNamespace}/channels/${encodedChannel}`,
  );
  const setup = await ensureTalonGameChannel(env, gameId, namespace);

  return {
    namespace,
    channel: TALON_CHANNEL,
    deletedSubscriptions,
    deletedChannel,
    setup,
    ok: setup.ok,
  };
}

function currentAgentForState(
  state: GameState,
): { team: Team; role: AgentRole; name: string } | undefined {
  if (state.status !== "active") {
    return undefined;
  }
  const role: AgentRole = state.turn.phase === "clue" ? "spymaster" : "guesser";
  return {
    team: state.turn.team,
    role,
    name: `${state.turn.team}-${role}`,
  };
}

function buildTurnTriggerMessage(
  state: GameState,
  agent: { team: Team; role: AgentRole; name: string },
  reason: string,
): string {
  if (agent.role === "spymaster") {
    return [
      `@${agent.name} ${agent.team} needs a clue in ${state.gameId}.`,
      "Inspect your private board state and make exactly one legal spymaster move.",
    ].join(" ");
  }

  const clue = state.turn.clue
    ? ` The current clue is "${state.turn.clue.word} ${state.turn.clue.count}" with ${state.turn.guessesRemaining} guess(es) remaining.`
    : "";
  return [
    `@${agent.name} ${agent.team} is guessing in ${state.gameId}.${clue}`,
    "Inspect your authorized game state and make exactly one legal guesser move, or pass.",
  ].join(" ");
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

  const token = await mintTalonBearerToken(env);
  const namespace = getTalonNamespace(env, state.gameId);
  if (!token || env.TALON_BOOTSTRAP_DISABLED === "true") {
    return {
      ok: false,
      skipped: true,
      agent: agent.name,
      team: agent.team,
      role: agent.role,
      namespace,
      channel: TALON_CHANNEL,
    };
  }

  const setup = await ensureTalonGameChannel(env, state.gameId, namespace);
  if (!setup.ok) {
    return {
      ok: false,
      agent: agent.name,
      team: agent.team,
      role: agent.role,
      namespace,
      channel: TALON_CHANNEL,
      error: setup.error ?? "Talon setup failed.",
    };
  }

  const response = await talonRequest(
    env,
    token,
    `/v1/ns/${encodeURIComponent(namespace)}/channels/${encodeURIComponent(TALON_CHANNEL)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        authorKind: "system",
        author: "codewords",
        content: buildTurnTriggerMessage(state, agent, reason),
        subscriptionNames: [agent.name],
        labels: {
          app: "codewords",
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
      team: agent.team,
      role: agent.role,
      namespace,
      channel: TALON_CHANNEL,
      error: `post channel message failed: ${response.status}`,
    };
  }

  const payload = await response.json<PostChannelMessageResponse>().catch(() => undefined);
  const routedSession = payload?.routed_sessions?.find((session) => session.agent === agent.name)
    ?? payload?.routedSessions?.find((session) => session.agent === agent.name);
  const sessionId = routedSessionId(routedSession);
  const messageId = payload?.message?.id;

  return {
    ok: true,
    status: response.status,
    agent: agent.name,
    team: agent.team,
    role: agent.role,
    namespace,
    channel: TALON_CHANNEL,
    messageId,
    sessionId,
  };
}

export function handleTalonOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": "86400",
    },
  });
}

function parseCodeWordsAgentName(agentName: unknown): { team: Team; role: AgentRole; name: string } | undefined {
  if (agentName === undefined) {
    return undefined;
  }
  if (typeof agentName !== "string") {
    throw new Error("agent_name must be a string when provided");
  }
  const match = agentName.match(/^(blue|red)-(spymaster|guesser)$/);
  if (!match) {
    throw new Error(`unsupported CodeWords agent: ${agentName}`);
  }
  return {
    team: match[1] as Team,
    role: match[2] as AgentRole,
    name: agentName,
  };
}

export async function handleTalonMcpAuthBroker(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const brokerToken = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!brokerToken) {
    return new Response("Missing authorization header.", { status: 401 });
  }

  let claims: Record<string, unknown>;
  try {
    claims = await verifySessionToken(env, brokerToken, TALON_MCP_AUTH_BROKER_AUDIENCE);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 401 });
  }

  const payload = await request.json<Record<string, unknown>>();
  if (claims["talon:ns"] !== payload.namespace || claims["talon:binding"] !== payload.binding_name) {
    return new Response("namespace or binding mismatch", { status: 403 });
  }
  if (claims["talon:agent"] !== payload.agent_name && !(claims["talon:agent"] === undefined && payload.agent_name === undefined)) {
    return new Response("agent mismatch", { status: 403 });
  }
  if (payload.server_ref !== CODEWORDS_MCP_SERVER || payload.binding_name !== CODEWORDS_MCP_SERVER) {
    return new Response("unsupported CodeWords MCP binding", { status: 400 });
  }
  if (
    typeof payload.audience === "string"
    && !ACCEPTED_MCP_AUTH_BROKER_REQUEST_AUDIENCES.has(payload.audience)
  ) {
    return new Response("unsupported CodeWords MCP auth broker audience", { status: 400 });
  }

  let agent: { team: Team; role: AgentRole; name: string } | undefined;
  try {
    agent = parseCodeWordsAgentName(payload.agent_name);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 400 });
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + TOKEN_TTL_SECONDS;
  const token = await mintSessionToken(env, {
    sub: agent ? `codewords-mcp:${String(payload.namespace)}:${agent.name}` : `codewords-mcp:${String(payload.namespace)}:tools`,
    aud: CODEWORDS_MCP_AUDIENCE,
    "talon:ns": payload.namespace,
    "talon:binding": CODEWORDS_MCP_SERVER,
    ...(agent
      ? {
          "talon:agent": agent.name,
          team: agent.team,
          role: agent.role,
        }
      : {}),
  });

  return jsonResponse({
    authorization_bearer_token: token,
    expires_at_unix: expiresAt,
    issued_at_unix: issuedAt,
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
  const mcpUrl = new URL(
    `/mcp/games/${encodeURIComponent(gameId)}/${team}/${role}`,
    url.origin,
  ).toString();
  const talonSetup = await ensureTalonGameChannel(env, gameId, namespace);
  const channelToken = await mintSessionToken(env, {
    sub: `codewords:${gameId}:channel:${TALON_CHANNEL}`,
    aud: TALON_AUDIENCE,
    "talon:ns": namespace,
    "talon:channel": TALON_CHANNEL,
    gameId,
    channel: TALON_CHANNEL,
  });
  const token = await mintSessionToken(env, {
    sub: `codewords:${gameId}:${agent}`,
    aud: TALON_AUDIENCE,
    "talon:ns": namespace,
    "talon:agent": agent,
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
        channelStreamUrl: `${getTalonApiBaseUrl(env).replace(/\/$/, "")}/v1/ns/${encodeURIComponent(namespace)}/channels/${encodeURIComponent(TALON_CHANNEL)}/stream`,
      },
    },
    {
      headers: {
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    },
  );
}

export async function handleTalonChannelToken(
  request: Request,
  env: Env,
  gameId: string,
): Promise<Response> {
  const namespace = getTalonNamespace(env, gameId);
  const talonSetup = await ensureTalonGameChannel(env, gameId, namespace);
  const token = await mintSessionToken(env, {
    sub: `codewords:${gameId}:channel:${TALON_CHANNEL}`,
    aud: TALON_AUDIENCE,
    "talon:ns": namespace,
    "talon:channel": TALON_CHANNEL,
    gameId,
    channel: TALON_CHANNEL,
  });
  const baseUrl = getTalonApiBaseUrl(env).replace(/\/$/, "");

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
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    },
  );
}
