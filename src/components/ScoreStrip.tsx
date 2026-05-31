import type { ScoreState } from '@/interfaces/game';

type ScoreStripProps = {
  scores: ScoreState;
};

export function ScoreStrip({ scores }: ScoreStripProps) {
  return (
    <section className="score-strip" aria-label="Score">
      <div className="score-block blue-score">
        <span>Blue</span>
        <strong>{scores.blue.wordsRevealed}/{scores.blue.wordsTotal}</strong>
      </div>
      <div className="score-block red-score">
        <span>Red</span>
        <strong>{scores.red.wordsRevealed}/{scores.red.wordsTotal}</strong>
      </div>
    </section>
  );
}
