import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';
import type { Env } from '../env';
import { getGameStub } from '../env';
import type { InternalCommand } from '../../interfaces/commands';
import type { AgentProjection, AgentRef, ProtocolMessage } from '../../interfaces/game';

export async function callGameCommand<T>(env: Env, gameId: string, command: InternalCommand): Promise<T> {
  const response = await getGameStub(env, gameId).fetch('https://codewords.internal/control', {
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

function requireAgent(agent: AgentRef | undefined): AgentRef {
  if (!agent) {
    throw new Error('This CodeWords MCP tool requires an agent-scoped bearer token.');
  }
  return agent;
}

export function createCodeWordsMcpServer(env: Env, gameId: string, agent?: AgentRef): McpServer {
  const server = new McpServer({
    name: agent ? `codewords-${gameId}-${agent.team}-${agent.role}` : `codewords-${gameId}`,
    version: '1.0.0',
  });

  server.registerTool(
    'get_board',
    {
      description: 'Get this agent role scoped board projection for the current game.',
      outputSchema: z.object({
        game: z.unknown(),
      }),
    },
    async () => {
      const scopedAgent = requireAgent(agent);
      const game = await callGameCommand<AgentProjection>(env, gameId, {
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
      outputSchema: z.object({
        game: z.unknown(),
      }),
    },
    async () => {
      const scopedAgent = requireAgent(agent);
      const game = await callGameCommand<AgentProjection>(env, gameId, {
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
        body: z.string().min(1),
        visibility: z.enum(['public', 'team', 'role']).optional(),
        toTeam: z.enum(['blue', 'red']).optional(),
        toRole: z.enum(['spymaster', 'guesser']).optional(),
      }),
      outputSchema: z.object({
        game: z.unknown(),
      }),
    },
    async ({ body, visibility, toTeam, toRole }) => {
      const scopedAgent = requireAgent(agent);
      const to = toTeam && toRole ? { team: toTeam, role: toRole } as AgentRef : undefined;
      const game = await callGameCommand<AgentProjection>(env, gameId, {
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
      outputSchema: z.object({
        messages: z.array(z.unknown()),
      }),
    },
    async () => {
      const scopedAgent = requireAgent(agent);
      const messages = await callGameCommand<ProtocolMessage[]>(env, gameId, {
        type: 'read-protocol-messages',
        agent: scopedAgent,
      });
      return {
        content: [{ type: 'text', text: `Read ${messages.length} protocol messages.` }],
        structuredContent: { messages },
      };
    },
  );

  if (!agent || agent.role === 'spymaster') {
    server.registerTool(
      'give_clue',
      {
        description:
          'Give a clue for this team. Only valid on this team’s clue phase. The clue must be one English word using letters only, and must not exactly match or prefix any board word.',
        inputSchema: z.object({
          word: z.string().min(1).regex(/^[A-Za-z]+$/, 'Clue must be one English word using letters only.'),
          count: z.number().int().min(1).max(9),
        }),
        outputSchema: z.object({
          game: z.unknown(),
        }),
      },
      async ({ word, count }) => {
        const scopedAgent = requireAgent(agent);
        const game = await callGameCommand<AgentProjection>(env, gameId, {
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

  if (!agent || agent.role === 'guesser') {
    server.registerTool(
      'make_guess',
      {
        description: 'Guess one card by card id or word. Only valid during this team’s guess phase.',
        inputSchema: z.object({
          cardId: z.string().optional(),
          word: z.string().optional(),
        }),
        outputSchema: z.object({
          game: z.unknown(),
        }),
      },
      async ({ cardId, word }) => {
        const scopedAgent = requireAgent(agent);
        const game = await callGameCommand<AgentProjection>(env, gameId, {
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
        outputSchema: z.object({
          game: z.unknown(),
        }),
      },
      async () => {
        const scopedAgent = requireAgent(agent);
        const game = await callGameCommand<AgentProjection>(env, gameId, {
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

  return server;
}
