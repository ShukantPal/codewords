import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { parseMcpAgentName } from '../cloudflare/routes/mcp';
import { handleTalonSessionToken } from '../cloudflare/routes/talon';
import type { Env } from '../cloudflare/env';

function decodeJwtClaims(token: string): Record<string, unknown> {
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  const expectedSignature = createHmac('sha256', 'test-secret')
    .update(parts.slice(0, 2).join('.'))
    .digest('base64url');
  assert.equal(parts[2], expectedSignature);
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

test('Talon session tokens are scoped to the default arena namespace', async () => {
  const env = {
    TALON_NAMESPACE: 'codewords',
    TALON_JWT_SECRET: 'test-secret',
    TALON_BOOTSTRAP_DISABLED: 'true',
  } as Env;
  const request = new Request('https://codewords.shukant.com/talon/games/demo-match/blue/spymaster/session-token');

  const response = await handleTalonSessionToken(request, env, 'main', 'demo-match', 'blue', 'spymaster');
  assert.equal(response.status, 200);

  const body = await response.json() as {
    namespace: string;
    agent: string;
    token: string;
    mcpUrl: string;
  };
  const claims = decodeJwtClaims(body.token);

  assert.equal(body.namespace, 'codewords:main');
  assert.equal(body.agent, 'openai-gpt-5-4-nano-blue-spymaster');
  assert.equal(body.mcpUrl, 'https://codewords.shukant.com/mcp/arenas/main/games/demo-match/blue/spymaster');
  assert.equal(claims.aud, 'talon');
  assert.equal(claims['talon:ns'], 'codewords:main');
  assert.equal(claims['talon:agent'], 'openai-gpt-5-4-nano-blue-spymaster');
  assert.equal(claims.arenaId, 'main');
  assert.equal(claims.gameId, 'demo-match');
});

test('Talon channel tokens are scoped to the game channel', async () => {
  const env = {
    TALON_NAMESPACE: 'codewords',
    TALON_JWT_SECRET: 'test-secret',
    TALON_BOOTSTRAP_DISABLED: 'true',
  } as Env;
  const request = new Request('https://codewords.shukant.com/talon/games/demo-match/channel-token');

  const { handleTalonChannelToken } = await import('../cloudflare/routes/talon');
  const response = await handleTalonChannelToken(request, env, 'main', 'demo-match');
  assert.equal(response.status, 200);

  const body = await response.json() as {
    namespace: string;
    channel: string;
    token: string;
  };
  const claims = decodeJwtClaims(body.token);

  assert.equal(body.namespace, 'codewords:main');
  assert.equal(body.channel, 'demo-match');
  assert.equal(claims.aud, 'talon');
  assert.equal(claims['talon:ns'], 'codewords:main');
  assert.equal(claims['talon:channel'], 'demo-match');
  assert.equal(claims.arenaId, 'main');
  assert.equal(claims.gameId, 'demo-match');
});

test('CodeWords MCP auth accepts model-specific Talon agent names', () => {
  assert.deepEqual(parseMcpAgentName('blue-spymaster'), {
    team: 'blue',
    role: 'spymaster',
  });
  assert.deepEqual(parseMcpAgentName('novita-minimax-minimax-m2-7-blue-spymaster'), {
    team: 'blue',
    role: 'spymaster',
  });
  assert.deepEqual(parseMcpAgentName('novita-meta-llama-llama-4-scout-17b-16e-instruct-red-guesser'), {
    team: 'red',
    role: 'guesser',
  });
});
