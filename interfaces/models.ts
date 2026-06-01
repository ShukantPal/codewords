import type { Team } from './game';

export type ModelConfig = {
  provider: string;
  name: string;
  temperature: number;
};

export type TeamModelConfig = ModelConfig & {
  team: Team;
};

export const ARENA_MODEL_CONFIGS: ModelConfig[] = [
  {
    provider: 'openai',
    name: 'gpt-5.4-nano',
    temperature: 1,
  },
  {
    provider: 'novita',
    name: 'minimax/minimax-m2.7',
    temperature: 1,
  },
  {
    provider: 'novita',
    name: 'deepseek/deepseek-v4-flash',
    temperature: 1,
  },
  {
    provider: 'novita',
    name: 'qwen/qwen3-next-80b-a3b-instruct',
    temperature: 1,
  },
];

export const ARENA_ROUND_GAME_COUNT = ARENA_MODEL_CONFIGS.length * (ARENA_MODEL_CONFIGS.length - 1);

export function modelForTeam(team: Team, model: ModelConfig): TeamModelConfig {
  return {
    ...model,
    team,
  };
}

export const TEAM_MODEL_CONFIGS: Record<Team, TeamModelConfig> = {
  blue: modelForTeam('blue', ARENA_MODEL_CONFIGS[0]),
  red: modelForTeam('red', ARENA_MODEL_CONFIGS[1]),
};

export function modelId(model: Pick<ModelConfig, 'provider' | 'name'>): string {
  return `${model.provider}/${model.name}`;
}
