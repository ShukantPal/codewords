import { useEffect, useState } from 'react';
import { TalonChannel } from '@talonai/copilot';
import type { SpectatorProjection } from '@/interfaces/game';
import { AgentMessageLog } from './components/AgentMessageLog';
import { Board } from './components/Board';
import { EventLog } from './components/EventLog';
import { ScoreStrip } from './components/ScoreStrip';
import { TurnPanel } from './components/TurnPanel';
import {
  fetchSpectatorGame,
  fetchTalonChannelSession,
  INITIAL_GAME_ID,
  subscribeToGame,
  type TalonChannelSession,
} from './client/codewordsClient';
import './styles.css';

type ConnectionState = 'connecting' | 'live' | 'error';
const showTalonChannelPanel = import.meta.env.DEV;

export default function App() {
  const [gameId] = useState(INITIAL_GAME_ID);
  const [showKey, setShowKey] = useState(false);
  const [game, setGame] = useState<SpectatorProjection | undefined>();
  const [talonChannel, setTalonChannel] = useState<TalonChannelSession | undefined>();
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | undefined>();
  const [talonError, setTalonError] = useState<string | undefined>();

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

  useEffect(() => {
    if (!showTalonChannelPanel) {
      return undefined;
    }
    let disposed = false;
    setTalonError(undefined);
    fetchTalonChannelSession(gameId)
      .then((session) => {
        if (!disposed) {
          setTalonChannel(session);
        }
      })
      .catch((fetchError: Error) => {
        if (!disposed) {
          setTalonError(fetchError.message);
        }
      });

    return () => {
      disposed = true;
    };
  }, [gameId]);

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
            {showTalonChannelPanel ? (
              <section className="log-panel talon-panel">
                <div className="panel-heading">
                  <h2>Chat</h2>
                  <span>{talonChannel ? `${talonChannel.namespace} / ${talonChannel.channel}` : 'connecting'}</span>
                </div>
                {talonError ? <div className="panel-error">{talonError}</div> : null}
                {talonChannel ? (
                  <TalonChannel
                    className="talon-channel"
                    gatewayUrl={talonChannel.talon.baseUrl}
                    authToken={`Bearer ${talonChannel.token}`}
                    namespace={talonChannel.namespace}
                    channel={talonChannel.channel}
                    author="spectator"
                    authorKind="user"
                    disableUserInput
                    messageLimit={40}
                    refreshIntervalMs={1500}
                    renderMessageActions={(message) => {
                      const sourceAgent = message.sourceAgent || message.source_agent;
                      const sourceSessionId = message.sourceSessionId || message.source_session_id;
                      if (!sourceAgent || !sourceSessionId) {
                        return null;
                      }
                      return <span className="session-chip">{sourceAgent}</span>;
                    }}
                  />
                ) : (
                  <div className="channel-loading">Loading channel</div>
                )}
              </section>
            ) : null}
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
