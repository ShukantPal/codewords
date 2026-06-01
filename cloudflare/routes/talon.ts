import type { AgentRole, Team } from "../../interfaces/game";
import type { GameState } from "../../interfaces/game";
import type { ArenaGameSummary } from "../../interfaces/arena";
import type { Env } from "../env";
import { getCodeWordsPublicUrl, getDefaultArenaId, getGameStub, getTalonApiBaseUrl, getTalonNamespace } from "../env";
import { jsonResponse } from "../durable-object/socket-protocol";
import type { TeamModelConfig } from "../../interfaces/models";
import { ARENA_MODEL_CONFIGS, modelForTeam, TEAM_MODEL_CONFIGS } from "../../interfaces/models";
import { guesserSystemPrompt, spymasterSystemPrompt } from "../../interfaces/agent-prompts";

const TOKEN_TTL_SECONDS = 60 * 15;
const TALON_AUDIENCE = "talon";
const CODEWORDS_MCP_SERVER = "codewords";
const CODEWORDS_MCP_AUDIENCE = "codewords-mcp";
const TALON_MCP_AUTH_BROKER_AUDIENCE = "conic-mcp-auth-broker";
const TALON_REVIEWER_AGENT_NAME = "codewords-reviewer";
const TALON_REVIEWER_SUBSCRIPTION_NAME = "game-reviewer";
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

export type TalonSessionStatus = {
  ok: boolean;
  state?: string;
  status?: string;
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

type TalonAgentRef = {
  team: Team;
  role: AgentRole;
  subscriptionName: string;
  talonAgentName: string;
  displayName: string;
};

type TalonReviewerRef = {
  subscriptionName: string;
  talonAgentName: string;
  displayName: string;
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
  systemPrompt: string;
}> = [
  {
    team: "blue",
    role: "spymaster",
    systemPrompt: spymasterSystemPrompt("blue"),
  },
  {
    team: "blue",
    role: "guesser",
    systemPrompt: guesserSystemPrompt("blue"),
  },
  {
    team: "red",
    role: "spymaster",
    systemPrompt: spymasterSystemPrompt("red"),
  },
  {
    team: "red",
    role: "guesser",
    systemPrompt: guesserSystemPrompt("red"),
  },
];

const TALON_REVIEWER_REF: TalonReviewerRef = {
  subscriptionName: TALON_REVIEWER_SUBSCRIPTION_NAME,
  talonAgentName: TALON_REVIEWER_AGENT_NAME,
  displayName: "game-reviewer",
};

function codeWordsSubscriptionName(team: Team, role: AgentRole): string {
  return `${team}-${role}`;
}

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "model";
}

function talonAgentNameForModel(team: Team, role: AgentRole, model: TeamModelConfig): string {
  return `${slugPart(model.provider)}-${slugPart(model.name)}-${team}-${role}`;
}

function talonAgentRefsForModels(models: Record<Team, TeamModelConfig>): TalonAgentRef[] {
  return TALON_AGENT_REFS.map((agent) => ({
    team: agent.team,
    role: agent.role,
    subscriptionName: codeWordsSubscriptionName(agent.team, agent.role),
    talonAgentName: talonAgentNameForModel(agent.team, agent.role, models[agent.team]),
    displayName: codeWordsSubscriptionName(agent.team, agent.role),
  }));
}

function allArenaTalonAgentRefs(): TalonAgentRef[] {
  return ARENA_MODEL_CONFIGS.flatMap((model) => (
    TALON_AGENT_REFS.map((agent) => {
      const teamModel = modelForTeam(agent.team, model);
      return {
        team: agent.team,
        role: agent.role,
        subscriptionName: codeWordsSubscriptionName(agent.team, agent.role),
        talonAgentName: talonAgentNameForModel(agent.team, agent.role, teamModel),
        displayName: codeWordsSubscriptionName(agent.team, agent.role),
      };
    })
  ));
}

function uniqueAgentRefs(refs: TalonAgentRef[]): TalonAgentRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.talonAgentName)) {
      return false;
    }
    seen.add(ref.talonAgentName);
    return true;
  });
}

function modelForTalonAgentRef(ref: TalonAgentRef, fallbackModels: Record<Team, TeamModelConfig>): TeamModelConfig {
  return ARENA_MODEL_CONFIGS
    .map((model) => modelForTeam(ref.team, model))
    .find((model) => talonAgentNameForModel(ref.team, ref.role, model) === ref.talonAgentName)
    ?? fallbackModels[ref.team];
}

function reviewerModelConfig(): TeamModelConfig {
  const model = ARENA_MODEL_CONFIGS.find((candidate) => candidate.name.includes("qwen3-next"))
    ?? ARENA_MODEL_CONFIGS[0]
    ?? TEAM_MODEL_CONFIGS.blue;
  return modelForTeam("blue", model);
}

async function loadGameModels(
  env: Env,
  arenaId: string,
  gameId: string | undefined,
): Promise<Record<Team, TeamModelConfig>> {
  if (!gameId) {
    return TEAM_MODEL_CONFIGS;
  }
  if (!env.CODEWORDS_GAME) {
    return TEAM_MODEL_CONFIGS;
  }
  const response = await getGameStub(env, arenaId, gameId).fetch("https://codewords.internal/summary");
  if (!response.ok) {
    return TEAM_MODEL_CONFIGS;
  }
  const summary = await response.json<ArenaGameSummary>();
  return summary.models ?? TEAM_MODEL_CONFIGS;
}

export function matchTalonPath(
  pathname: string,
): { arenaId?: string; gameId?: string; team: Team; role: AgentRole } | undefined {
  const arenaGameMatch = pathname.match(
    /^\/talon\/arenas\/([^/]+)\/games\/([^/]+)\/(blue|red)\/(spymaster|guesser)\/session-token$/,
  );
  if (arenaGameMatch) {
    return {
      arenaId: decodeURIComponent(arenaGameMatch[1]),
      gameId: decodeURIComponent(arenaGameMatch[2]),
      team: arenaGameMatch[3] as Team,
      role: arenaGameMatch[4] as AgentRole,
    };
  }
  const arenaMatch = pathname.match(
    /^\/talon\/arenas\/([^/]+)\/(blue|red)\/(spymaster|guesser)\/session-token$/,
  );
  if (arenaMatch) {
    return {
      arenaId: decodeURIComponent(arenaMatch[1]),
      team: arenaMatch[2] as Team,
      role: arenaMatch[3] as AgentRole,
    };
  }
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
): { arenaId?: string; gameId: string } | undefined {
  const arenaMatch = pathname.match(/^\/talon\/arenas\/([^/]+)\/games\/([^/]+)\/channel-token$/);
  if (arenaMatch) {
    return {
      arenaId: decodeURIComponent(arenaMatch[1]),
      gameId: decodeURIComponent(arenaMatch[2]),
    };
  }
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
    "get_review_materials",
    "submit_review",
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
  const encodedNamespace = encodeURIComponent(namespace);
  const binding = {
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
  };
  const bindingPath = `/v1/namespaces/${encodedNamespace}/mcp-bindings/${encodeURIComponent(CODEWORDS_MCP_SERVER)}`;
  const existing = await talonRequest(env, token, bindingPath);
  if (existing.status === 404) {
    const response = await talonRequest(env, token, `/v1/namespaces/${encodedNamespace}/mcp-bindings`, {
      method: "POST",
      body: JSON.stringify({
        ns: namespace,
        binding,
      }),
    });
    if (!response.ok) {
      throw new Error(`create MCP binding failed: ${response.status}`);
    }
    return;
  }
  if (!existing.ok) {
    throw new Error(`get MCP binding failed: ${existing.status}`);
  }

  const update = await talonRequest(env, token, bindingPath, {
    method: "PUT",
    body: JSON.stringify({
      ns: namespace,
      binding,
    }),
  });
  if (!update.ok) {
    const fallback = await talonRequest(env, token, `/v1/namespaces/${encodedNamespace}/mcp-bindings`, {
      method: "POST",
      body: JSON.stringify({
        ns: namespace,
        binding,
      }),
    });
    if (!fallback.ok) {
      throw new Error(`update MCP binding failed: ${update.status}`);
    }
  }
}

async function ensureTalonGameChannel(
  env: Env,
  arenaId: string,
  gameId: string,
  namespace: string,
  models: Record<Team, TeamModelConfig> = TEAM_MODEL_CONFIGS,
): Promise<TalonSetupResult> {
  const channel = gameId;
  const agentRefs = talonAgentRefsForModels(models);
  const namespaceAgentRefs = uniqueAgentRefs([...agentRefs, ...allArenaTalonAgentRefs()]);
  const token = await mintTalonBearerToken(env);
  if (!token || env.TALON_BOOTSTRAP_DISABLED === "true") {
    const agentNames = namespaceAgentRefs.map((agent) => agent.talonAgentName);
    return {
      namespace,
      channel,
      agents: agentNames,
      subscriptions: agentRefs.map((agent) => agent.subscriptionName),
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
          labels: { app: "codewords", arenaId },
        }),
      },
    );
    if (!createNamespaceResponse.ok) {
      return {
        namespace,
        channel,
        agents: namespaceAgentRefs.map((agent) => agent.talonAgentName),
        subscriptions: [],
        ok: false,
        error: `create namespace failed: ${createNamespaceResponse.status}`,
      };
    }
  } else if (!namespaceResponse.ok) {
    return {
      namespace,
      channel,
      agents: namespaceAgentRefs.map((agent) => agent.talonAgentName),
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
      channel,
      agents: namespaceAgentRefs.map((agent) => agent.talonAgentName),
      subscriptions: [],
      mcpServer: CODEWORDS_MCP_SERVER,
      mcpBinding: CODEWORDS_MCP_SERVER,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const agents: string[] = [];
  for (const agent of namespaceAgentRefs) {
    const source = TALON_AGENT_REFS.find((ref) => ref.team === agent.team && ref.role === agent.role);
    const model = modelForTalonAgentRef(agent, models);
    const agentPath = `/v1/ns/${encodedNamespace}/agents/${encodeURIComponent(agent.talonAgentName)}`;
    const agentResponse = await talonRequest(env, token, agentPath);
    const agentDefinition = {
      customSpec: {
        systemPrompt: source?.systemPrompt ?? `You are the ${agent.displayName} in a CodeWords match.`,
        modelPolicy: {
          profiles: [
            {
              name: "default",
              model: {
                provider: model.provider,
                name: model.name,
                temperature: model.temperature,
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
            name: agent.talonAgentName,
            definition: agentDefinition,
            labels: {
              app: "codewords",
              arenaId,
              team: agent.team,
              role: agent.role,
              modelProvider: model.provider,
              modelName: model.name,
            },
          }),
        },
      );
      if (!createAgentResponse.ok) {
        return {
          namespace,
          channel,
          agents,
          subscriptions: [],
          ok: false,
          error: `create agent ${agent.talonAgentName} failed: ${createAgentResponse.status}`,
        };
      }
    } else if (!agentResponse.ok) {
      return {
        namespace,
        channel,
        agents,
        subscriptions: [],
        ok: false,
        error: `get agent ${agent.talonAgentName} failed: ${agentResponse.status}`,
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
              arenaId,
              team: agent.team,
              role: agent.role,
              modelProvider: model.provider,
              modelName: model.name,
            },
          }),
        },
      );
      if (!updateAgentResponse.ok) {
        return {
          namespace,
          channel,
          agents,
          subscriptions: [],
          mcpServer: CODEWORDS_MCP_SERVER,
          mcpBinding: CODEWORDS_MCP_SERVER,
          ok: false,
          error: `update agent ${agent.talonAgentName} failed: ${updateAgentResponse.status}`,
        };
      }
    }
    agents.push(agent.talonAgentName);
  }

  const reviewerModel = reviewerModelConfig();
  const reviewerDefinition = {
    customSpec: {
      systemPrompt: [
        "You are the CodeWords arena game reviewer.",
        "You are triggered only after a game ends.",
        "Use the CodeWords MCP get_review_materials tool to inspect the final board, event timeline, models, scores, illegal moves, and revealed cards.",
        "Then call submit_review exactly once with a concise but strategic postgame analysis: what each side tried, decisive errors, clue quality, guessing quality, and one tuning recommendation per model.",
        "If submit_review is not available, call send_protocol_message exactly once with the review in the body field; CodeWords treats that as the review submission for this reviewer agent.",
        "Do not make moves in the game.",
      ].join(" "),
      modelPolicy: {
        profiles: [
          {
            name: "default",
            model: {
              provider: reviewerModel.provider,
              name: reviewerModel.name,
              temperature: 0.4,
            },
          },
        ],
      },
      mcpServerRefs: [CODEWORDS_MCP_SERVER],
    },
  };
  const reviewerPath = `/v1/ns/${encodedNamespace}/agents/${encodeURIComponent(TALON_REVIEWER_REF.talonAgentName)}`;
  const reviewerResponse = await talonRequest(env, token, reviewerPath);
  const reviewerLabels = {
    app: "codewords",
    arenaId,
    role: "reviewer",
    modelProvider: reviewerModel.provider,
    modelName: reviewerModel.name,
  };
  if (reviewerResponse.status === 404) {
    const createReviewerResponse = await talonRequest(
      env,
      token,
      `/v1/ns/${encodedNamespace}/agents`,
      {
        method: "POST",
        body: JSON.stringify({
          name: TALON_REVIEWER_REF.talonAgentName,
          definition: reviewerDefinition,
          labels: reviewerLabels,
        }),
      },
    );
    if (!createReviewerResponse.ok) {
      return {
        namespace,
        channel,
        agents,
        subscriptions: [],
        ok: false,
        error: `create agent ${TALON_REVIEWER_REF.talonAgentName} failed: ${createReviewerResponse.status}`,
      };
    }
  } else if (!reviewerResponse.ok) {
    return {
      namespace,
      channel,
      agents,
      subscriptions: [],
      ok: false,
      error: `get agent ${TALON_REVIEWER_REF.talonAgentName} failed: ${reviewerResponse.status}`,
    };
  } else {
    const updateReviewerResponse = await talonRequest(
      env,
      token,
      reviewerPath,
      {
        method: "PUT",
        body: JSON.stringify({
          definition: reviewerDefinition,
          labels: reviewerLabels,
        }),
      },
    );
    if (!updateReviewerResponse.ok) {
      return {
        namespace,
        channel,
        agents,
        subscriptions: [],
        ok: false,
        error: `update agent ${TALON_REVIEWER_REF.talonAgentName} failed: ${updateReviewerResponse.status}`,
      };
    }
  }
  agents.push(TALON_REVIEWER_REF.talonAgentName);

  const channelPath = `/v1/ns/${encodedNamespace}/channels/${encodeURIComponent(channel)}`;
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
            name: channel,
            ns: namespace,
            title: `CodeWords ${gameId}`,
            status: "open",
            metadata: { arenaId, gameId },
            labels: { app: "codewords", arenaId, gameId },
          },
        }),
      },
    );
    if (!createChannelResponse.ok) {
      return {
        namespace,
        channel,
        agents,
        subscriptions: [],
        ok: false,
        error: `create channel failed: ${createChannelResponse.status}`,
      };
    }
  } else if (!channelResponse.ok) {
    return {
      namespace,
      channel,
      agents,
      subscriptions: [],
      ok: false,
      error: `get channel failed: ${channelResponse.status}`,
    };
  }

  const subscriptions: string[] = [];
  for (const agent of agentRefs) {
    const model = models[agent.team];
    const subscriptionPath = `/v1/ns/${encodedNamespace}/channels/${encodeURIComponent(channel)}/subscriptions/${encodeURIComponent(agent.subscriptionName)}`;
    const subscriptionResponse = await talonRequest(
      env,
      token,
      subscriptionPath,
    );
    if (subscriptionResponse.status === 404) {
      const createSubscriptionResponse = await talonRequest(
        env,
        token,
        `/v1/ns/${encodedNamespace}/channels/${encodeURIComponent(channel)}/subscriptions`,
        {
          method: "POST",
          body: JSON.stringify({
            subscription: {
              name: agent.subscriptionName,
              ns: namespace,
              channel,
              agent: agent.talonAgentName,
              enabled: true,
              trigger: "manual",
              contextPolicy: {
                mode: "recent_public",
                maxMessages: 20,
              },
              labels: {
                app: "codewords",
                arenaId,
                gameId,
                team: agent.team,
                role: agent.role,
                modelProvider: model.provider,
                modelName: model.name,
              },
            },
          }),
        },
      );
      if (!createSubscriptionResponse.ok) {
        return {
          namespace,
          channel,
          agents,
          subscriptions,
          ok: false,
          error: `create subscription ${agent.subscriptionName} failed: ${createSubscriptionResponse.status}`,
        };
      }
    } else if (!subscriptionResponse.ok) {
      return {
        namespace,
        channel,
        agents,
        subscriptions,
        ok: false,
        error: `get subscription ${agent.subscriptionName} failed: ${subscriptionResponse.status}`,
      };
    }
    subscriptions.push(agent.subscriptionName);
  }

  const reviewerSubscriptionPath = `/v1/ns/${encodedNamespace}/channels/${encodeURIComponent(channel)}/subscriptions/${encodeURIComponent(TALON_REVIEWER_REF.subscriptionName)}`;
  const reviewerSubscriptionResponse = await talonRequest(
    env,
    token,
    reviewerSubscriptionPath,
  );
  if (reviewerSubscriptionResponse.status === 404) {
    const createReviewerSubscriptionResponse = await talonRequest(
      env,
      token,
      `/v1/ns/${encodedNamespace}/channels/${encodeURIComponent(channel)}/subscriptions`,
      {
        method: "POST",
        body: JSON.stringify({
          subscription: {
            name: TALON_REVIEWER_REF.subscriptionName,
            ns: namespace,
            channel,
            agent: TALON_REVIEWER_REF.talonAgentName,
            enabled: true,
            trigger: "manual",
            contextPolicy: {
              mode: "recent_public",
              maxMessages: 200,
            },
            labels: {
              app: "codewords",
              arenaId,
              gameId,
              role: "reviewer",
              modelProvider: reviewerModel.provider,
              modelName: reviewerModel.name,
            },
          },
        }),
      },
    );
    if (!createReviewerSubscriptionResponse.ok) {
      return {
        namespace,
        channel,
        agents,
        subscriptions,
        ok: false,
        error: `create subscription ${TALON_REVIEWER_REF.subscriptionName} failed: ${createReviewerSubscriptionResponse.status}`,
      };
    }
  } else if (!reviewerSubscriptionResponse.ok) {
    return {
      namespace,
      channel,
      agents,
      subscriptions,
      ok: false,
      error: `get subscription ${TALON_REVIEWER_REF.subscriptionName} failed: ${reviewerSubscriptionResponse.status}`,
    };
  }
  subscriptions.push(TALON_REVIEWER_REF.subscriptionName);

  return {
    namespace,
    channel,
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

export async function resetTalonGameChannel(
  env: Env,
  arenaId: string,
  gameId: string,
  models: Record<Team, TeamModelConfig> = TEAM_MODEL_CONFIGS,
): Promise<TalonChannelResetResult> {
  const namespace = getTalonNamespace(env, arenaId);
  const channel = gameId;
  const agentRefs = talonAgentRefsForModels(models);
  const token = await mintTalonBearerToken(env);
  if (!token || env.TALON_BOOTSTRAP_DISABLED === "true") {
    return {
      namespace,
      channel,
      deletedSubscriptions: [],
      deletedChannel: false,
      ok: false,
      skipped: true,
    };
  }

  const encodedNamespace = encodeURIComponent(namespace);
  const encodedChannel = encodeURIComponent(channel);
  const deletedSubscriptions: string[] = [];
  for (const agent of [...agentRefs, TALON_REVIEWER_REF]) {
    const deleted = await deleteTalonResource(
      env,
      token,
      `/v1/ns/${encodedNamespace}/channels/${encodedChannel}/subscriptions/${encodeURIComponent(agent.subscriptionName)}`,
    );
    if (deleted) {
      deletedSubscriptions.push(agent.subscriptionName);
    }
  }

  const deletedChannel = await deleteTalonResource(
    env,
    token,
    `/v1/ns/${encodedNamespace}/channels/${encodedChannel}`,
  );
  const setup = await ensureTalonGameChannel(env, arenaId, gameId, namespace, models);

  return {
    namespace,
    channel,
    deletedSubscriptions,
    deletedChannel,
    setup,
    ok: setup.ok,
  };
}

export async function deleteTalonGameChannel(
  env: Env,
  arenaId: string,
  gameId: string,
  models: Record<Team, TeamModelConfig> = TEAM_MODEL_CONFIGS,
): Promise<TalonChannelResetResult> {
  const namespace = getTalonNamespace(env, arenaId);
  const channel = gameId;
  const agentRefs = talonAgentRefsForModels(models);
  const token = await mintTalonBearerToken(env);
  if (!token || env.TALON_BOOTSTRAP_DISABLED === "true") {
    return {
      namespace,
      channel,
      deletedSubscriptions: [],
      deletedChannel: false,
      ok: false,
      skipped: true,
    };
  }

  const encodedNamespace = encodeURIComponent(namespace);
  const encodedChannel = encodeURIComponent(channel);
  const deletedSubscriptions: string[] = [];
  for (const agent of [...agentRefs, TALON_REVIEWER_REF]) {
    const deleted = await deleteTalonResource(
      env,
      token,
      `/v1/ns/${encodedNamespace}/channels/${encodedChannel}/subscriptions/${encodeURIComponent(agent.subscriptionName)}`,
    );
    if (deleted) {
      deletedSubscriptions.push(agent.subscriptionName);
    }
  }

  const deletedChannel = await deleteTalonResource(
    env,
    token,
    `/v1/ns/${encodedNamespace}/channels/${encodedChannel}`,
  );

  return {
    namespace,
    channel,
    deletedSubscriptions,
    deletedChannel,
    ok: true,
  };
}

function currentAgentForState(
  state: GameState,
): TalonAgentRef | undefined {
  if (state.status !== "active") {
    return undefined;
  }
  const role: AgentRole = state.turn.phase === "clue" ? "spymaster" : "guesser";
  return talonAgentRefsForModels(state.models).find((agent) => agent.team === state.turn.team && agent.role === role);
}

function buildTurnTriggerMessage(
  state: GameState,
  agent: TalonAgentRef,
  reason: string,
): string {
  if (agent.role === "spymaster") {
    return [
      `@${agent.displayName} ${agent.team} needs a clue in ${state.gameId}.`,
      `Use gameId "${state.gameId}" with your CodeWords MCP tools.`,
      `First call get_turn or get_board and obey legalActions as authoritative. Verify the game is active, the current team is ${agent.team}, and the phase is clue.`,
      "If that is not true, do not move; call channel_skip_reply if available and stop.",
      "Do a private clue analysis before moving: group your unrevealed words, check opponent/neutral/assassin danger words, and choose the safest useful clue.",
      "Give exactly one legal clue with give_clue, then stop.",
      "Legal clue rule: one English word, letters only, no spaces/punctuation/hyphens/digits, and no exact or prefix relationship with any board word.",
      "Prefer count 1 or 2 unless a larger group is clearly safe.",
      "Do not make guesses or publish the hidden key.",
    ].join(" ");
  }

  const clue = state.turn.clue
    ? ` The current clue is "${state.turn.clue.word} ${state.turn.clue.count}" with ${state.turn.guessesRemaining} guess(es) remaining.`
    : "";
  return [
    `@${agent.displayName} ${agent.team} is guessing in ${state.gameId}.${clue}`,
    `Use gameId "${state.gameId}" with your CodeWords MCP tools.`,
    `First call get_turn or get_board and obey legalActions as authoritative. Verify the game is active, the current team is ${agent.team}, and the phase is guess.`,
    "If that is not true, do not move; call channel_skip_reply if available and stop.",
    "Do a private candidate analysis before each move: rank clue matches, identify trap words, and compare the top candidate against alternatives.",
    "Use make_guess for one exact word from legalActions.allowedGuessWords at a time.",
    "After every guess, inspect the returned legalActions and game state before acting again.",
    "If the game finished, the team changed, the phase changed, or guessesRemaining is 0, stop immediately.",
    "Continue only if the next candidate is clearly connected and safe. If confidence is not high, call pass_turn exactly once and stop.",
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
  const namespace = getTalonNamespace(env, state.arenaId);
  const channel = state.gameId;
  if (!token || env.TALON_BOOTSTRAP_DISABLED === "true") {
    return {
      ok: false,
      skipped: true,
      agent: agent.talonAgentName,
      team: agent.team,
      role: agent.role,
      namespace,
      channel,
    };
  }

  const setup = await ensureTalonGameChannel(env, state.arenaId, state.gameId, namespace, state.models);
  if (!setup.ok) {
    return {
      ok: false,
      agent: agent.talonAgentName,
      team: agent.team,
      role: agent.role,
      namespace,
      channel,
      error: setup.error ?? "Talon setup failed.",
    };
  }

  const response = await talonRequest(
    env,
    token,
    `/v1/ns/${encodeURIComponent(namespace)}/channels/${encodeURIComponent(channel)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        authorKind: "system",
        author: "codewords",
        content: buildTurnTriggerMessage(state, agent, reason),
        subscriptionNames: [agent.subscriptionName],
        labels: {
          app: "codewords",
          arenaId: state.arenaId,
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
      agent: agent.talonAgentName,
      team: agent.team,
      role: agent.role,
      namespace,
      channel,
      error: `post channel message failed: ${response.status}`,
    };
  }

  const payload = await response.json<PostChannelMessageResponse>().catch(() => undefined);
  const routedSession = payload?.routed_sessions?.find((session) => {
    const normalized = session as { subscription?: string; agent?: string };
    return normalized.subscription === agent.subscriptionName || normalized.agent === agent.talonAgentName;
  }) ?? payload?.routedSessions?.find((session) => {
    const normalized = session as { subscription?: string; agent?: string };
    return normalized.subscription === agent.subscriptionName || normalized.agent === agent.talonAgentName;
  });
  const sessionId = routedSessionId(routedSession);
  const messageId = payload?.message?.id;

  return {
    ok: true,
    status: response.status,
    agent: agent.talonAgentName,
    team: agent.team,
    role: agent.role,
    namespace,
    channel,
    messageId,
    sessionId,
  };
}

function buildReviewTriggerMessage(state: GameState, reason: string): string {
  return [
    `@${TALON_REVIEWER_REF.displayName} review finished CodeWords game ${state.gameId}.`,
    `Winner: ${state.winner ?? "unknown"}.`,
    `Use gameId "${state.gameId}" with your CodeWords MCP tools.`,
    "Inspect the final game materials, then call submit_review exactly once.",
    "If submit_review is not available, call send_protocol_message exactly once with the review in the body field.",
    `Reason: ${reason}.`,
  ].join(" ");
}

export async function triggerTalonReviewerForState(
  env: Env,
  state: GameState,
  reason: string,
): Promise<TalonTriggerResult | undefined> {
  if (state.status !== "finished") {
    return undefined;
  }

  const token = await mintTalonBearerToken(env);
  const namespace = getTalonNamespace(env, state.arenaId);
  const channel = state.gameId;
  if (!token || env.TALON_BOOTSTRAP_DISABLED === "true") {
    return {
      ok: false,
      skipped: true,
      agent: TALON_REVIEWER_REF.talonAgentName,
      team: "blue",
      role: "spymaster",
      namespace,
      channel,
    };
  }

  const setup = await ensureTalonGameChannel(env, state.arenaId, state.gameId, namespace, state.models);
  if (!setup.ok) {
    return {
      ok: false,
      agent: TALON_REVIEWER_REF.talonAgentName,
      team: "blue",
      role: "spymaster",
      namespace,
      channel,
      error: setup.error ?? "Talon setup failed.",
    };
  }

  const response = await talonRequest(
    env,
    token,
    `/v1/ns/${encodeURIComponent(namespace)}/channels/${encodeURIComponent(channel)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        authorKind: "system",
        author: "codewords",
        content: buildReviewTriggerMessage(state, reason),
        subscriptionNames: [TALON_REVIEWER_REF.subscriptionName],
        labels: {
          app: "codewords",
          arenaId: state.arenaId,
          gameId: state.gameId,
          role: "reviewer",
          reason,
        },
      }),
    },
  );

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      agent: TALON_REVIEWER_REF.talonAgentName,
      team: "blue",
      role: "spymaster",
      namespace,
      channel,
      error: `post review message failed: ${response.status}`,
    };
  }

  const payload = await response.json<PostChannelMessageResponse>().catch(() => undefined);
  const routedSession = payload?.routed_sessions?.find((session) => {
    const normalized = session as { subscription?: string; agent?: string };
    return normalized.subscription === TALON_REVIEWER_REF.subscriptionName
      || normalized.agent === TALON_REVIEWER_REF.talonAgentName;
  }) ?? payload?.routedSessions?.find((session) => {
    const normalized = session as { subscription?: string; agent?: string };
    return normalized.subscription === TALON_REVIEWER_REF.subscriptionName
      || normalized.agent === TALON_REVIEWER_REF.talonAgentName;
  });

  return {
    ok: true,
    status: response.status,
    agent: TALON_REVIEWER_REF.talonAgentName,
    team: "blue",
    role: "spymaster",
    namespace,
    channel,
    messageId: payload?.message?.id,
    sessionId: routedSessionId(routedSession),
  };
}

export async function getTalonAgentSessionStatus(
  env: Env,
  session: { namespace: string; agent: string; sessionId: string },
): Promise<TalonSessionStatus> {
  const token = await mintTalonBearerToken(env);
  if (!token || env.TALON_BOOTSTRAP_DISABLED === "true") {
    return { ok: false, error: "Talon bootstrap is disabled." };
  }
  const response = await talonRequest(
    env,
    token,
    `/v1/ns/${encodeURIComponent(session.namespace)}/agents/${encodeURIComponent(session.agent)}/sessions/${encodeURIComponent(session.sessionId)}`,
  );
  if (!response.ok) {
    return { ok: false, status: String(response.status), error: `get session failed: ${response.status}` };
  }
  const payload = await response.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const rawSession = payload["session"];
  const nested = (rawSession && typeof rawSession === "object" ? rawSession : payload) as Record<string, unknown>;
  return {
    ok: true,
    state: typeof nested.state === "string" ? nested.state : undefined,
    status: typeof nested.status === "string" ? nested.status : undefined,
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
  const match = agentName.match(/(?:^|.*-)(blue|red)-(spymaster|guesser)$/);
  if (!match) {
    throw new Error(`unsupported CodeWords agent: ${agentName}`);
  }
  return {
    team: match[1] as Team,
    role: match[2] as AgentRole,
    name: agentName,
  };
}

function parseCodeWordsReviewerName(agentName: unknown): { name: string } | undefined {
  if (agentName === undefined) {
    return undefined;
  }
  if (typeof agentName !== "string") {
    throw new Error("agent_name must be a string when provided");
  }
  if (agentName !== TALON_REVIEWER_AGENT_NAME) {
    return undefined;
  }
  return { name: agentName };
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
  let reviewer: { name: string } | undefined;
  try {
    reviewer = parseCodeWordsReviewerName(payload.agent_name);
    agent = reviewer ? undefined : parseCodeWordsAgentName(payload.agent_name);
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
    ...(reviewer
      ? {
          "talon:agent": reviewer.name,
          "codewords:reviewer": true,
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
  arenaId: string,
  gameId: string | undefined,
  team: Team,
  role: AgentRole,
): Promise<Response> {
  const url = new URL(request.url);
  const namespace = getTalonNamespace(env, arenaId);
  const models = await loadGameModels(env, arenaId, gameId);
  const requestedAgent = url.searchParams.get("agentName") ?? url.searchParams.get("agent");
  let parsedRequestedAgent: { team: Team; role: AgentRole; name: string } | undefined;
  try {
    parsedRequestedAgent = requestedAgent ? parseCodeWordsAgentName(requestedAgent) : undefined;
  } catch {
    parsedRequestedAgent = undefined;
  }
  const agent = parsedRequestedAgent && parsedRequestedAgent.team === team && parsedRequestedAgent.role === role
    ? parsedRequestedAgent.name
    : talonAgentNameForModel(team, role, models[team]);
  const sessionId = `${arenaId}-${agent}`;
  const mcpUrl = new URL(
    gameId
      ? `/mcp/arenas/${encodeURIComponent(arenaId)}/games/${encodeURIComponent(gameId)}/${team}/${role}`
      : `/mcp/arenas/${encodeURIComponent(arenaId)}/${team}/${role}`,
    url.origin,
  ).toString();
  const talonSetup = gameId
    ? await ensureTalonGameChannel(env, arenaId, gameId, namespace, models)
    : {
        namespace,
        channel: gameId ?? '',
        agents: talonAgentRefsForModels(models).map((ref) => ref.talonAgentName),
        subscriptions: [],
        ok: true,
      };
  const channelToken = await mintSessionToken(env, {
    sub: `codewords:${arenaId}${gameId ? `:${gameId}` : ''}:channel`,
    aud: TALON_AUDIENCE,
    "talon:ns": namespace,
    ...(gameId ? { "talon:channel": gameId, gameId, channel: gameId } : {}),
    arenaId,
  });
  const token = await mintSessionToken(env, {
    sub: `codewords:${arenaId}:${agent}`,
    aud: TALON_AUDIENCE,
    "talon:ns": namespace,
    "talon:agent": agent,
    arenaId,
    ...(gameId ? { gameId } : {}),
    team,
    role,
  });

  return jsonResponse(
    {
      arenaId,
      gameId,
      team,
      role,
      token,
      agentToken: token,
      channelToken,
      namespace,
      channel: gameId,
      agent,
      sessionId,
      expiresInSeconds: TOKEN_TTL_SECONDS,
      mcpUrl,
      talon: {
        baseUrl: getTalonApiBaseUrl(env),
        setup: talonSetup,
        channelStreamUrl: gameId
          ? `${getTalonApiBaseUrl(env).replace(/\/$/, "")}/v1/ns/${encodeURIComponent(namespace)}/channels/${encodeURIComponent(gameId)}/stream`
          : undefined,
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
  arenaId: string,
  gameId: string,
): Promise<Response> {
  const namespace = getTalonNamespace(env, arenaId);
  const models = await loadGameModels(env, arenaId, gameId);
  const talonSetup = await ensureTalonGameChannel(env, arenaId, gameId, namespace, models);
  const token = await mintSessionToken(env, {
    sub: `codewords:${arenaId}:${gameId}:channel`,
    aud: TALON_AUDIENCE,
    "talon:ns": namespace,
    "talon:channel": gameId,
    arenaId,
    gameId,
    channel: gameId,
  });
  const baseUrl = getTalonApiBaseUrl(env).replace(/\/$/, "");

  return jsonResponse(
    {
      arenaId,
      gameId,
      namespace,
      channel: gameId,
      token,
      expiresInSeconds: TOKEN_TTL_SECONDS,
      talon: {
        baseUrl,
        setup: talonSetup,
        channelStreamUrl: `${baseUrl}/v1/ns/${encodeURIComponent(namespace)}/channels/${encodeURIComponent(gameId)}/stream`,
        channelMessagesUrl: `${baseUrl}/v1/ns/${encodeURIComponent(namespace)}/channels/${encodeURIComponent(gameId)}/messages`,
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
