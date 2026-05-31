import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { simulateHttpGame } from '../../scripts/simulate-http-game';

const BASE_URL = 'http://localhost:8790';

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw lastError instanceof Error ? lastError : new Error('Timed out waiting for Worker health check.');
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
  try {
    await once(child, 'exit');
  } finally {
    clearTimeout(timeout);
  }
}

test('HTTP simulator can finish an isolated local Worker game', { timeout: 120_000 }, async () => {
  const child = spawn('npx', ['wrangler', 'dev', '--local', '--port', '8790'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    logs += String(chunk);
  });

  try {
    await waitForHealth(BASE_URL, 45_000);

    const first = await simulateHttpGame({
      baseUrl: BASE_URL,
      gameId: `integration-${Date.now()}-a`,
      maxTurns: 40,
      strategy: 'safe',
    });
    const second = await simulateHttpGame({
      baseUrl: BASE_URL,
      gameId: `integration-${Date.now()}-b`,
      maxTurns: 40,
      strategy: 'safe',
    });

    assert.ok(first.winner);
    assert.ok(second.winner);
    assert.notEqual(first.gameId, second.gameId);
    assert.ok(first.events > 0);
    assert.ok(second.events > 0);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\nWrangler logs:\n${logs}`);
  } finally {
    await stopProcess(child);
  }
});
