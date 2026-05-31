import type { SpectatorProjection } from '@/interfaces/game';

type TurnPanelProps = {
  game: SpectatorProjection;
  onTriggerAgent: () => void;
  triggerPending: boolean;
};

export function TurnPanel({ game, onTriggerAgent, triggerPending }: TurnPanelProps) {
  const clue = game.turn.clue;
  const activeAgent = `${game.turn.team}-${game.turn.phase === 'clue' ? 'spymaster' : 'guesser'}`;
  return (
    <section className="side-panel">
      <div className="panel-heading turn-heading">
        <h2>Turn</h2>
        <button
          className="action-button"
          type="button"
          onClick={onTriggerAgent}
          disabled={triggerPending || game.status !== 'active'}
        >
          {triggerPending ? 'Triggering' : `Trigger ${activeAgent}`}
        </button>
      </div>
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
