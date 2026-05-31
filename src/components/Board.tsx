import type { SpectatorCard } from '@/interfaces/game';

const ownerLabel: Record<string, string> = {
  blue: 'Blue',
  red: 'Red',
  neutral: 'Neutral',
  assassin: 'Assassin',
};

type BoardProps = {
  cards: SpectatorCard[];
};

export function Board({ cards }: BoardProps) {
  return (
    <section className="board" aria-label="CodeWords board">
      {cards.map((card) => (
        <div
          className={[
            'board-tile',
            card.revealed ? 'is-revealed' : 'is-hidden',
            card.owner ? `owner-${card.owner}` : '',
          ].join(' ')}
          key={card.id}
        >
          <span className="tile-word">{card.word}</span>
          <span className="tile-meta">{card.owner ? ownerLabel[card.owner] : 'Hidden'}</span>
        </div>
      ))}
    </section>
  );
}
