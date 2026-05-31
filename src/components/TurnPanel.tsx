import type { SpectatorProjection } from '@/interfaces/game';

type TurnPanelProps = {
  game: SpectatorProjection;
  onTriggerAgent: () => void;
  onOpenActiveSession: () => void;
  triggerPending: boolean;
};

export function TurnPanel({ game, onTriggerAgent, onOpenActiveSession, triggerPending }: TurnPanelProps) {
  const clue = game.turn.clue;
  const activeAgent = `${game.turn.team}-${game.turn.phase === 'clue' ? 'spymaster' : 'guesser'}`;
  const statusLabel = game.winner ? `${game.winner} won` : game.status;
  return (
    <section className="side-panel">
      <div className="panel-heading turn-heading">
        <div className="turn-title-row">
          <h2>Turn</h2>
          <button
            className={`status-pill ${game.activeTalonSession ? 'is-clickable' : ''}`}
            type="button"
            onClick={onOpenActiveSession}
            disabled={!game.activeTalonSession}
            title={game.activeTalonSession ? `Open ${game.activeTalonSession.agent}` : 'No active Talon session yet'}
          >
            {statusLabel}
          </button>
        </div>
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
      </dl>
    </section>
  );
}
