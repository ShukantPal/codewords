import { useEffect, useState } from 'react';
import type { SpectatorProjection } from '@/interfaces/game';
import { AgentMessageLog } from './components/AgentMessageLog';
import { Board } from './components/Board';
import { EventLog } from './components/EventLog';
import { ScoreStrip } from './components/ScoreStrip';
import { TurnPanel } from './components/TurnPanel';
import { fetchSpectatorGame, INITIAL_GAME_ID, subscribeToGame } from './client/codewordsClient';
import './styles.css';

type ConnectionState = 'connecting' | 'live' | 'error';

export default function App() {
  const [gameId] = useState(INITIAL_GAME_ID);
  const [showKey, setShowKey] = useState(false);
  const [game, setGame] = useState<SpectatorProjection | undefined>();
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let disposed = false;
    setConnection('connecting');
    setError(undefined);

    fetchSpectatorGame(gameId, showKey)
      .then((snapshot) => {
        if (!disposed) {
          setGame(snapshot);
          setConnection('live');
        }
      })
      .catch((fetchError: Error) => {
        if (!disposed) {
          setError(fetchError.message);
          setConnection('error');
        }
      });

    const unsubscribe = subscribeToGame(
      gameId,
      showKey,
      (snapshot) => {
        if (!disposed) {
          setGame(snapshot);
          setConnection('live');
        }
      },
      (socketError) => {
        if (!disposed) {
          setError(socketError.message);
          setConnection('error');
        }
      },
    );

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [gameId, showKey]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI CodeWords Arena</p>
          <h1>{gameId}</h1>
        </div>
        <div className="topbar-actions">
          <span className={`connection ${connection}`}>{connection}</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={showKey}
              onChange={(event) => setShowKey(event.target.checked)}
            />
            <span>Show key</span>
          </label>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      {game ? (
        <div className="workspace">
          <div className="primary-column">
            <ScoreStrip scores={game.scores} />
            <Board cards={game.board} />
          </div>
          <aside className="secondary-column">
            <TurnPanel game={game} />
            <EventLog events={game.events} />
            <AgentMessageLog messages={game.messages} />
          </aside>
        </div>
      ) : (
        <div className="loading">Loading match</div>
      )}
    </main>
  );
}
