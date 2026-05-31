import type { GameEvent } from '@/interfaces/game';

type EventLogProps = {
  events: GameEvent[];
};

export function EventLog({ events }: EventLogProps) {
  return (
    <section className="log-panel">
      <h2>Timeline</h2>
      <ol className="event-list">
        {[...events].reverse().map((event) => (
          <li key={event.id}>
            <span>{event.summary}</span>
            <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
