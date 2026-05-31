import type { ScoreState } from '@/interfaces/game';

type ScoreStripProps = {
  scores: ScoreState;
};

export function ScoreStrip({ scores }: ScoreStripProps) {
  return (
    <section className="score-strip" aria-label="Score">
      <div className="score-block blue-score">
        <div className="score-team">
          <span>Blue</span>
          <small>OpenAI · gpt-5.4-nano</small>
        </div>
        <strong>{scores.blue.wordsRevealed}/{scores.blue.wordsTotal}</strong>
      </div>
      <div className="score-block red-score">
        <div className="score-team">
          <span>Red</span>
          <small>Novita · minimax/minimax-m2.7</small>
        </div>
        <strong>{scores.red.wordsRevealed}/{scores.red.wordsTotal}</strong>
      </div>
    </section>
  );
}
