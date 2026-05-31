import type { SpectatorProjection } from '@/interfaces/game';

type TurnPanelProps = {
  game: SpectatorProjection;
};

export function TurnPanel({ game }: TurnPanelProps) {
  const clue = game.turn.clue;
  return (
    <section className="side-panel">
      <h2>Turn</h2>
      <dl className="detail-list">
        <div>
          <dt>Team</dt>
          <dd className={`team-text ${game.turn.team}`}>{game.turn.team}</dd>
        </div>
        <div>
          <dt>Phase</dt>
          <dd>{game.turn.phase}</dd>
        </div>
        <div>
          <dt>Clue</dt>
          <dd>{clue ? `${clue.word} ${clue.count}` : 'Waiting'}</dd>
        </div>
        <div>
          <dt>Guesses</dt>
          <dd>{game.turn.guessesRemaining}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{game.winner ? `${game.winner} won` : game.status}</dd>
        </div>
      </dl>
    </section>
  );
}
