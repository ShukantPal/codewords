import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import type { AgentProjection, AgentRole, SpectatorProjection, Team } from '../interfaces/game';

type SimulatorStrategy = 'safe' | 'random';

type SimulatorOptions = {
  baseUrl: string;
  gameId: string;
  maxTurns: number;
  strategy: SimulatorStrategy;
  delayMs?: number;
  seed?: number;
  token?: string;
  log?: (line: string) => void;
};

type SimulatorResult = {
  gameId: string;
  winner: Team;
  turns: number;
  events: number;
};

function parseArgs(argv: string[]): SimulatorOptions {
  const options: SimulatorOptions = {
    baseUrl: 'http://localhost:8790',
    gameId: `sim-${Date.now()}`,
    maxTurns: 40,
    strategy: 'safe',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--base-url') {
      options.baseUrl = argv[index + 1];
      index += 1;
    } else if (value === '--game-id') {
      options.gameId = argv[index + 1];
      index += 1;
    } else if (value === '--max-turns') {
      options.maxTurns = Number(argv[index + 1]);
      index += 1;
    } else if (value === '--delay-ms') {
      options.delayMs = Number(argv[index + 1]);
      index += 1;
    } else if (value === '--strategy') {
      const strategy = argv[index + 1];
      if (strategy !== 'safe' && strategy !== 'random') {
        throw new Error('--strategy must be safe or random.');
      }
      options.strategy = strategy;
      index += 1;
    } else if (value === '--seed') {
      options.seed = Number(argv[index + 1]);
      index += 1;
    } else if (value === '--token') {
      options.token = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

function createRandom(seed = Date.now()): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
}

async function delay(ms?: number): Promise<void> {
  if (!ms || ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson<T>(
  options: SimulatorOptions,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body) {
    headers.set('content-type', 'application/json');
  }
  if (options.token) {
    headers.set('authorization', `Bearer ${options.token}`);
  }

  const response = await fetch(`${options.baseUrl}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method || 'GET'} ${path} failed with ${response.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

function agentPath(gameId: string, team: Team, role: AgentRole, action?: string): string {
  const base = `/api/games/${encodeURIComponent(gameId)}/agents/${team}/${role}`;
  return action ? `${base}/${action}` : base;
}

async function getSpectator(
  options: SimulatorOptions,
  showKey: boolean,
): Promise<SpectatorProjection> {
  return requestJson<SpectatorProjection>(
    options,
    `/api/games/${encodeURIComponent(options.gameId)}?showKey=${String(showKey)}`,
  );
}

async function getAgent(
  options: SimulatorOptions,
  team: Team,
  role: AgentRole,
): Promise<AgentProjection> {
  return requestJson<AgentProjection>(options, agentPath(options.gameId, team, role));
}

async function postAgent(
  options: SimulatorOptions,
  team: Team,
  role: AgentRole,
  action: string,
  body?: unknown,
): Promise<AgentProjection> {
  return requestJson<AgentProjection>(options, agentPath(options.gameId, team, role, action), {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

function assertProjectionBoundaries(spymaster: AgentProjection, guesser: AgentProjection): void {
  assert.equal(spymaster.board.every((card) => Boolean(card.owner)), true, 'spymaster should see owners');
  assert.equal(
    guesser.board.some((card) => !card.revealed && Boolean(card.owner)),
    false,
    'guesser should not see hidden owners',
  );
}

export async function simulateHttpGame(options: SimulatorOptions): Promise<SimulatorResult> {
  const random = createRandom(options.seed);
  options.log?.(`reset ${options.gameId}`);
  await requestJson<SpectatorProjection>(options, `/api/games/${encodeURIComponent(options.gameId)}/reset`, {
    method: 'POST',
  });

  const hiddenSpectator = await getSpectator(options, false);
  const keyedSpectator = await getSpectator(options, true);
  assert.equal(hiddenSpectator.board.some((card) => !card.revealed && Boolean(card.owner)), false);
  assert.equal(keyedSpectator.board.every((card) => Boolean(card.owner)), true);

  await postAgent(options, 'blue', 'spymaster', 'messages', {
    body: `Simulation started for ${options.gameId}.`,
    visibility: 'public',
  });

  let lastEventCount = 0;
  let turns = 0;

  while (turns < options.maxTurns) {
    const spectator = await getSpectator(options, false);
    lastEventCount = Math.max(lastEventCount, spectator.events.length);

    if (spectator.status === 'finished') {
      assert.ok(spectator.winner);
      return {
        gameId: options.gameId,
        winner: spectator.winner,
        turns,
        events: spectator.events.length,
      };
    }

    const team = spectator.turn.team;
    if (spectator.turn.phase === 'clue') {
      const spymaster = await getAgent(options, team, 'spymaster');
      const guesser = await getAgent(options, team, 'guesser');
      assertProjectionBoundaries(spymaster, guesser);

      const beforeEvents = spymaster.events.length;
      const clueResult = await postAgent(options, team, 'spymaster', 'clue', {
        word: 'safe',
        count: 1,
      });
      assert.equal(clueResult.turn.phase, 'guess');
      assert.ok(clueResult.events.length >= beforeEvents);
      options.log?.(`${team} clue safe 1`);
      await delay(options.delayMs);
    } else {
      const spymaster = await getAgent(options, team, 'spymaster');
      const guesser = await getAgent(options, team, 'guesser');
      assertProjectionBoundaries(spymaster, guesser);

      const candidates = options.strategy === 'safe'
        ? spymaster.board.filter((card) => !card.revealed && card.owner === team)
        : guesser.board.filter((card) => !card.revealed);
      const candidate = candidates[Math.floor(random() * candidates.length)];

      if (!candidate) {
        await postAgent(options, team, 'guesser', 'pass');
        options.log?.(`${team} pass`);
        await delay(options.delayMs);
      } else {
        const guessResult = await postAgent(options, team, 'guesser', 'guess', {
          cardId: candidate.id,
        });
        options.log?.(`${team} ${options.strategy} guess ${candidate.word}`);
        await delay(options.delayMs);

        if (guessResult.status !== 'finished' && guessResult.turn.phase === 'guess' && guessResult.turn.team === team) {
          await postAgent(options, team, 'guesser', 'pass');
          options.log?.(`${team} pass after guess`);
          await delay(options.delayMs);
        }
      }
      turns += 1;
    }
  }

  const finalState = await getSpectator(options, true);
  throw new Error(
    `Simulation did not finish within ${options.maxTurns} turns. ` +
      `status=${finalState.status} winner=${finalState.winner ?? 'none'} events=${lastEventCount}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const options = parseArgs(process.argv.slice(2));
  const result = await simulateHttpGame({
    ...options,
    log: (line) => console.log(line),
  });
  console.log(JSON.stringify(result, null, 2));
}
