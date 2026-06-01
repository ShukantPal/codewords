import type { ScoreState } from '@/interfaces/game';
import type { TeamModelConfig } from '@/interfaces/models';

type ScoreStripProps = {
  scores: ScoreState;
  models: Record<'blue' | 'red', TeamModelConfig>;
};

export function ScoreStrip({ scores, models }: ScoreStripProps) {
  return (
    <section className="score-strip" aria-label="Score">
      <div className="score-block blue-score">
        <div className="score-team">
          <span>Blue</span>
          <small>{models.blue.provider} · {models.blue.name}</small>
        </div>
        <strong>{scores.blue.wordsRevealed}/{scores.blue.wordsTotal}</strong>
      </div>
      <div className="score-block red-score">
        <div className="score-team">
          <span>Red</span>
          <small>{models.red.provider} · {models.red.name}</small>
        </div>
        <strong>{scores.red.wordsRevealed}/{scores.red.wordsTotal}</strong>
      </div>
    </section>
  );
}
