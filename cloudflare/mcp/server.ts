import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { Env } from '../env';
import { getGameStub } from '../env';
import type { InternalCommand } from '../../interfaces/commands';
import type { AgentProjection, AgentRef, ProtocolMessage, SpectatorProjection } from '../../interfaces/game';

export async function callGameCommand<T>(env: Env, arenaId: string, gameId: string, command: InternalCommand): Promise<T> {
  const response = await getGameStub(env, arenaId, gameId).fetch('https://codewords.internal/control', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Game command failed with ${response.status}.`);
  }

  return response.json<T>();
}

function resolveGameId(inputGameId: unknown, fixedGameId: string | undefined): string {
  const gameId = (typeof inputGameId === 'string' ? inputGameId.trim() : '') || fixedGameId;
  if (!gameId) {
    throw new Error('gameId is required for arena-scoped CodeWords MCP tools.');
  }
  return gameId;
}

function requireAgent(agent: AgentRef | undefined): AgentRef {
  if (!agent) {
    throw new Error('This CodeWords MCP tool requires an agent-scoped bearer token.');
  }
  return agent;
}

function compactReviewMaterials(game: SpectatorProjection) {
  return {
    arenaId: game.arenaId,
    gameId: game.gameId,
    status: game.status,
    winner: game.winner,
    models: game.models,
    scores: game.scores,
    finalTurn: game.turn,
    board: game.board.map((card) => ({
      word: card.word,
      owner: card.owner,
      revealed: card.revealed,
      revealedBy: card.revealedBy,
    })),
    timeline: game.events.map((event) => ({
      type: event.type,
      summary: event.summary,
      at: event.createdAt,
    })),
    publicMessages: game.messages.map((message) => ({
      from: `${message.from.team}-${message.from.role}`,
      to: message.to ? `${message.to.team}-${message.to.role}` : undefined,
      visibility: message.visibility,
      body: message.body,
    })),
  };
}

export function createCodeWordsMcpServer(
  env: Env,
  arenaId: string,
  fixedGameId?: string,
  agent?: AgentRef,
  reviewer?: string,
): McpServer {
  const server = new McpServer({
    name: agent ? `codewords-${arenaId}-${agent.team}-${agent.role}` : `codewords-${arenaId}`,
    version: '1.0.0',
  });

  const gameIdInput = fixedGameId ? {} : { gameId: z.string().min(1) };

  if (!reviewer) {
    server.registerTool(
    'get_board',
    {
      description: 'Get this agent role scoped board projection for the current game.',
      inputSchema: z.object(gameIdInput),
      outputSchema: z.object({
        game: z.unknown(),
      }),
    },
    async ({ gameId: inputGameId }) => {
      const scopedAgent = requireAgent(agent);
      const gameId = resolveGameId(inputGameId, fixedGameId);
      const game = await callGameCommand<AgentProjection>(env, arenaId, gameId, {
        type: 'get-state',
        projection: { type: 'agent', agent: scopedAgent },
      });
      return {
        content: [{ type: 'text', text: `Fetched ${scopedAgent.team} ${scopedAgent.role} board for ${gameId}.` }],
        structuredContent: { game },
      };
    },
    );

    server.registerTool(
    'get_turn',
    {
      description: 'Get the current turn, clue, scores, and game status for this game.',
      inputSchema: z.object(gameIdInput),
      outputSchema: z.object({
        game: z.unknown(),
      }),
    },
    async ({ gameId: inputGameId }) => {
      const scopedAgent = requireAgent(agent);
      const gameId = resolveGameId(inputGameId, fixedGameId);
      const game = await callGameCommand<AgentProjection>(env, arenaId, gameId, {
        type: 'get-state',
        projection: { type: 'agent', agent: scopedAgent },
      });
      return {
        content: [{ type: 'text', text: `Fetched current turn for ${gameId}.` }],
        structuredContent: { game },
      };
    },
    );

    server.registerTool(
    'send_protocol_message',
    {
      description: 'Send a protocol message into the game timeline for other agents or spectators.',
      inputSchema: z.object({
        ...gameIdInput,
        body: z.string().min(1),
        visibility: z.enum(['public', 'team', 'role']).optional(),
        toTeam: z.enum(['blue', 'red']).optional(),
        toRole: z.enum(['spymaster', 'guesser']).optional(),
      }),
      outputSchema: z.object({
        game: z.unknown(),
      }),
    },
    async ({ gameId: inputGameId, body, visibility, toTeam, toRole }) => {
      const scopedAgent = requireAgent(agent);
      const gameId = resolveGameId(inputGameId, fixedGameId);
      const to = toTeam && toRole ? { team: toTeam, role: toRole } as AgentRef : undefined;
      const game = await callGameCommand<AgentProjection>(env, arenaId, gameId, {
        type: 'send-protocol-message',
        agent: scopedAgent,
        payload: { body, visibility, to },
      });
      return {
        content: [{ type: 'text', text: 'Sent protocol message.' }],
        structuredContent: { game },
      };
    },
    );

    server.registerTool(
    'read_protocol_messages',
    {
      description: 'Read protocol messages visible to this agent.',
      inputSchema: z.object(gameIdInput),
      outputSchema: z.object({
        messages: z.array(z.unknown()),
      }),
    },
    async ({ gameId: inputGameId }) => {
      const scopedAgent = requireAgent(agent);
      const gameId = resolveGameId(inputGameId, fixedGameId);
      const messages = await callGameCommand<ProtocolMessage[]>(env, arenaId, gameId, {
        type: 'read-protocol-messages',
        agent: scopedAgent,
      });
      return {
        content: [{ type: 'text', text: `Read ${messages.length} protocol messages.` }],
        structuredContent: { messages },
      };
    },
    );
  }

  if (!reviewer && (!agent || agent.role === 'spymaster')) {
    server.registerTool(
      'give_clue',
      {
        description:
          'Give a clue for this team. Only valid on this team’s clue phase. The clue must be one English word using letters only, and must not exactly match or prefix any board word.',
        inputSchema: z.object({
          ...gameIdInput,
          word: z.string().min(1).regex(/^[A-Za-z]+$/, 'Clue must be one English word using letters only.'),
          count: z.number().int().min(1).max(9),
        }),
        outputSchema: z.object({
          game: z.unknown(),
        }),
      },
      async ({ gameId: inputGameId, word, count }) => {
        const scopedAgent = requireAgent(agent);
        const gameId = resolveGameId(inputGameId, fixedGameId);
        const game = await callGameCommand<AgentProjection>(env, arenaId, gameId, {
          type: 'give-clue',
          agent: scopedAgent,
          payload: { word, count },
        });
        return {
          content: [{ type: 'text', text: `Gave clue ${word} ${count}.` }],
          structuredContent: { game },
        };
      },
    );
  }

  if (!reviewer && (!agent || agent.role === 'guesser')) {
    server.registerTool(
      'make_guess',
      {
        description: 'Guess one card by card id or word. Only valid during this team’s guess phase.',
        inputSchema: z.object({
          ...gameIdInput,
          cardId: z.string().optional(),
          word: z.string().optional(),
        }),
        outputSchema: z.object({
          game: z.unknown(),
        }),
      },
      async ({ gameId: inputGameId, cardId, word }) => {
        const scopedAgent = requireAgent(agent);
        const gameId = resolveGameId(inputGameId, fixedGameId);
        const game = await callGameCommand<AgentProjection>(env, arenaId, gameId, {
          type: 'make-guess',
          agent: scopedAgent,
          payload: { cardId, word },
        });
        return {
          content: [{ type: 'text', text: `Made guess ${word || cardId}.` }],
          structuredContent: { game },
        };
      },
    );

    server.registerTool(
      'pass_turn',
      {
        description: 'Pass the rest of this team’s guess phase.',
        inputSchema: z.object(gameIdInput),
        outputSchema: z.object({
          game: z.unknown(),
        }),
      },
      async ({ gameId: inputGameId }) => {
        const scopedAgent = requireAgent(agent);
        const gameId = resolveGameId(inputGameId, fixedGameId);
        const game = await callGameCommand<AgentProjection>(env, arenaId, gameId, {
          type: 'pass-turn',
          agent: scopedAgent,
        });
        return {
          content: [{ type: 'text', text: 'Passed turn.' }],
          structuredContent: { game },
        };
      },
    );
  }

  if (reviewer) {
    const getReviewProjection = async (inputGameId: unknown) => {
      const gameId = resolveGameId(inputGameId, fixedGameId);
      const game = await callGameCommand<SpectatorProjection>(env, arenaId, gameId, {
        type: 'get-state',
        projection: { type: 'spectator', showKey: true },
      });
      return { gameId, game: compactReviewMaterials(game) };
    };

    server.registerTool(
      'get_board',
      {
        description:
          'Reviewer alias for get_review_materials. Get the final full board and timeline for a finished CodeWords game.',
        inputSchema: z.object(gameIdInput),
        outputSchema: z.object({
          game: z.unknown(),
        }),
      },
      async ({ gameId: inputGameId }) => {
        const { gameId, game } = await getReviewProjection(inputGameId);
        return {
          content: [{ type: 'text', text: `Fetched compact review board for ${gameId}. Analyze it, then call submit_review exactly once.` }],
          structuredContent: { game },
        };
      },
    );

    server.registerTool(
      'get_turn',
      {
        description:
          'Reviewer alias for get_review_materials. Get final turn, scores, models, and timeline for a finished CodeWords game.',
        inputSchema: z.object(gameIdInput),
        outputSchema: z.object({
          game: z.unknown(),
        }),
      },
      async ({ gameId: inputGameId }) => {
        const { gameId, game } = await getReviewProjection(inputGameId);
        return {
          content: [{ type: 'text', text: `Fetched compact review state for ${gameId}. Analyze it, then call submit_review exactly once.` }],
          structuredContent: { game },
        };
      },
    );

    server.registerTool(
      'read_protocol_messages',
      {
        description:
          'Reviewer alias for reading public game messages included in the review materials.',
        inputSchema: z.object(gameIdInput),
        outputSchema: z.object({
          messages: z.array(z.unknown()),
        }),
      },
      async ({ gameId: inputGameId }) => {
        const { gameId, game } = await getReviewProjection(inputGameId);
        return {
          content: [{ type: 'text', text: `Read ${game.publicMessages.length} public protocol messages for ${gameId}.` }],
          structuredContent: { messages: game.publicMessages },
        };
      },
    );

    server.registerTool(
      'send_protocol_message',
      {
        description:
          'Reviewer compatibility alias for submit_review. Submit the final game review in the body field.',
        inputSchema: z.object({
          ...gameIdInput,
          body: z.string().min(40),
          visibility: z.enum(['public', 'team', 'role']).optional(),
          toTeam: z.enum(['blue', 'red']).optional(),
          toRole: z.enum(['spymaster', 'guesser']).optional(),
        }),
        outputSchema: z.object({
          game: z.unknown(),
        }),
      },
      async ({ gameId: inputGameId, body }) => {
        const gameId = resolveGameId(inputGameId, fixedGameId);
        const game = await callGameCommand<SpectatorProjection>(env, arenaId, gameId, {
          type: 'submit-review',
          reviewer,
          payload: { summary: body },
        });
        return {
          content: [{ type: 'text', text: 'Submitted game review.' }],
          structuredContent: { game },
        };
      },
    );

    server.registerTool(
      'get_review_materials',
      {
        description:
          'Get the final full board, timeline, scores, models, and metrics needed to review a finished CodeWords game.',
        inputSchema: z.object(gameIdInput),
        outputSchema: z.object({
          game: z.unknown(),
        }),
      },
      async ({ gameId: inputGameId }) => {
        const { gameId, game } = await getReviewProjection(inputGameId);
        return {
          content: [{ type: 'text', text: `Fetched compact review materials for ${gameId}. Analyze them, then call submit_review exactly once.` }],
          structuredContent: { game },
        };
      },
    );

    server.registerTool(
      'submit_review',
      {
        description:
          'Submit the final game review. Use this exactly once after analyzing the completed board, timeline, mistakes, and model strategies.',
        inputSchema: z.object({
          ...gameIdInput,
          review: z.string().min(40),
        }),
        outputSchema: z.object({
          game: z.unknown(),
        }),
      },
      async ({ gameId: inputGameId, review }) => {
        const gameId = resolveGameId(inputGameId, fixedGameId);
        const game = await callGameCommand<SpectatorProjection>(env, arenaId, gameId, {
          type: 'submit-review',
          reviewer,
          payload: { summary: review },
        });
        return {
          content: [{ type: 'text', text: 'Submitted game review.' }],
          structuredContent: { game },
        };
      },
    );
  }

  return server;
}
