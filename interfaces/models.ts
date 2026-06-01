import type { Team } from './game';

export type TeamModelConfig = {
  team: Team;
  provider: string;
  name: string;
  temperature: number;
};

export const TEAM_MODEL_CONFIGS: Record<Team, TeamModelConfig> = {
  blue: {
    team: 'blue',
    provider: 'openai',
    name: 'gpt-5.4-nano',
    temperature: 1,
  },
  red: {
    team: 'red',
    provider: 'novita',
    name: 'minimax/minimax-m2.7',
    temperature: 1,
  },
};

export function modelId(model: Pick<TeamModelConfig, 'provider' | 'name'>): string {
  return `${model.provider}/${model.name}`;
}
