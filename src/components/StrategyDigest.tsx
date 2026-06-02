import type { CardOwner, GameEvent, SpectatorProjection } from '@/interfaces/game';

type GuessEvent = Extract<GameEvent, { type: 'card-revealed' }>;

type StrategyDigestProps = {
  game: SpectatorProjection;
};

function ownerLabel(owner: CardOwner): string {
  if (owner === 'assassin') {
    return 'assassin';
  }
  return owner;
}

function isMistake(guess: GuessEvent): boolean {
  return guess.owner !== guess.team;
}

export function StrategyDigest({ game }: StrategyDigestProps) {
  let clueIndex = -1;
  for (let index = game.events.length - 1; index >= 0; index -= 1) {
    if (game.events[index].type === 'clue-given') {
      clueIndex = index;
      break;
    }
  }
  const clueCandidate = clueIndex >= 0 ? game.events[clueIndex] : undefined;
  const latestClue = clueCandidate?.type === 'clue-given' ? clueCandidate : undefined;
  const clueWindow = clueIndex >= 0 ? game.events.slice(clueIndex + 1) : [];
  const guesses = clueWindow.filter((event): event is GuessEvent => event.type === 'card-revealed');
  const mistakes = guesses.filter(isMistake);
  const passes = clueWindow.filter((event) => event.type === 'turn-passed');
  const illegalMoves = clueWindow.filter((event) => event.type === 'illegal-move');
  const lastGuess = guesses.at(-1);

  return (
    <section className="log-panel strategy-panel">
      <div className="panel-heading">
        <h2>Strategy Digest</h2>
        <span>{game.status === 'finished' ? `${game.winner} won` : `${game.turn.team} ${game.turn.phase}`}</span>
      </div>
      {latestClue ? (
        <>
          <div className="strategy-clue">
            <span className={`lane-chip lane-${latestClue.team}`}>{latestClue.team}</span>
            <strong>{latestClue.clue} {latestClue.count}</strong>
            <span>{latestClue.actor.role}</span>
          </div>
          <div className="strategy-stat-grid">
            <div>
              <span>Guesses</span>
              <strong>{guesses.length}</strong>
            </div>
            <div>
              <span>Mistakes</span>
              <strong>{mistakes.length}</strong>
            </div>
            <div>
              <span>Illegal</span>
              <strong>{illegalMoves.length}</strong>
            </div>
            <div>
              <span>Passes</span>
              <strong>{passes.length}</strong>
            </div>
          </div>
          <div className="strategy-sequence">
            {guesses.length > 0 ? guesses.map((guess) => (
              <span
                className={`guess-token ${isMistake(guess) ? 'is-mistake' : 'is-correct'}`}
                key={guess.id}
                title={`${guess.word}: ${ownerLabel(guess.owner)}`}
              >
                {guess.word}
              </span>
            )) : (
              <span className="muted-copy">No guesses made under this clue yet.</span>
            )}
          </div>
          {mistakes.length > 0 ? (
            <p className="strategy-note">
              Latest mistake: {mistakes.at(-1)?.word} was {ownerLabel(mistakes.at(-1)?.owner ?? 'neutral')}.
            </p>
          ) : lastGuess ? (
            <p className="strategy-note">Latest guess was safe: {lastGuess.word} belonged to {lastGuess.owner}.</p>
          ) : null}
        </>
      ) : (
        <div className="channel-loading">Waiting for the first clue.</div>
      )}
    </section>
  );
}
