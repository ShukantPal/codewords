import type { ScoreState } from '@/interfaces/game';
import type { TeamModelConfig } from '@/interfaces/models';
import { ModelBadge } from './ModelBadge';

type ScoreStripProps = {
  scores: ScoreState;
  models: Record<'blue' | 'red', TeamModelConfig>;
};

export function ScoreStrip({ scores, models }: ScoreStripProps) {
  return (
    <section className="score-strip" aria-label="Score">
      <div className="score-block blue-score">
        <div className="score-team">
          <span className="score-team-heading">
            <ModelBadge model={models.blue} />
            <span>Blue</span>
          </span>
          <small>{models.blue.provider} · {models.blue.name}</small>
        </div>
        <strong>{scores.blue.wordsRevealed}/{scores.blue.wordsTotal}</strong>
      </div>
      <div className="score-block red-score">
        <div className="score-team">
          <span className="score-team-heading">
            <ModelBadge model={models.red} />
            <span>Red</span>
          </span>
          <small>{models.red.provider} · {models.red.name}</small>
        </div>
        <strong>{scores.red.wordsRevealed}/{scores.red.wordsTotal}</strong>
      </div>
    </section>
  );
}
