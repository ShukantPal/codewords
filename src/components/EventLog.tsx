import type { GameEvent } from '@/interfaces/game';

type EventLogProps = {
  events: GameEvent[];
};

function laneForEvent(event: GameEvent): { key: string; label: string } {
  switch (event.type) {
    case 'game-reset':
    case 'game-finished':
    case 'game-reviewed':
      return { key: 'system', label: 'System' };
    case 'clue-given':
      return { key: 'clue', label: 'Clue' };
    case 'card-revealed':
      return { key: 'guess', label: 'Guess' };
    case 'turn-passed':
      return { key: 'pass', label: 'Pass' };
    case 'protocol-message':
      return { key: 'protocol', label: 'Protocol' };
    case 'illegal-move':
      return { key: 'illegal', label: 'Illegal' };
  }
}

export function EventLog({ events }: EventLogProps) {
  return (
    <section className="log-panel">
      <div className="panel-heading">
        <h2>Move Timeline</h2>
        <span>{events.length} events</span>
      </div>
      <ol className="event-list">
        {[...events].reverse().map((event) => {
          const lane = laneForEvent(event);
          return (
          <li className="event-row" key={event.id}>
            <span className={`lane-chip lane-${lane.key}`}>{lane.label}</span>
            <span className="event-summary">{event.summary}</span>
            <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
          </li>
          );
        })}
      </ol>
    </section>
  );
}
