import { useEffect, useState } from 'react';
import { TalonChannel, TalonCopilot } from '@talonai/copilot';
import type { SpectatorProjection } from '@/interfaces/game';
import { Board } from './components/Board';
import { EventLog } from './components/EventLog';
import { ScoreStrip } from './components/ScoreStrip';
import { TurnPanel } from './components/TurnPanel';
import {
  fetchSpectatorGame,
  fetchTalonAgentSession,
  fetchTalonChannelSession,
  INITIAL_GAME_ID,
  restartGame,
  subscribeToGame,
  triggerCurrentAgent,
  type TalonAgentSession,
  type TalonChannelSession,
} from './client/codewordsClient';
import './styles.css';

type ConnectionState = 'connecting' | 'live' | 'error';
const showTalonChannelPanel = true;

export default function App() {
  const [gameId] = useState(INITIAL_GAME_ID);
  const [showKey, setShowKey] = useState(false);
  const [game, setGame] = useState<SpectatorProjection | undefined>();
  const [talonChannel, setTalonChannel] = useState<TalonChannelSession | undefined>();
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | undefined>();
  const [talonError, setTalonError] = useState<string | undefined>();
  const [triggerPending, setTriggerPending] = useState(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [talonAgentSession, setTalonAgentSession] = useState<TalonAgentSession | undefined>();
  const [talonAgentError, setTalonAgentError] = useState<string | undefined>();
  const [restartPending, setRestartPending] = useState(false);

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

  const handleTriggerAgent = () => {
    setTriggerPending(true);
    setError(undefined);
    triggerCurrentAgent(gameId, showKey)
      .then((snapshot) => {
        setGame(snapshot);
        setConnection('live');
      })
      .catch((triggerError: Error) => {
        setError(triggerError.message);
      })
      .finally(() => {
        setTriggerPending(false);
      });
  };

  const handleRestartGame = () => {
    setRestartPending(true);
    setError(undefined);
    restartGame(gameId)
      .then((snapshot) => {
        setGame(snapshot);
        setConnection('live');
        setSessionModalOpen(false);
        setTalonAgentSession(undefined);
      })
      .catch((restartError: Error) => {
        setError(restartError.message);
      })
      .finally(() => {
        setRestartPending(false);
      });
  };

  const activeTalonSession = game?.activeTalonSession;

  useEffect(() => {
    if (!sessionModalOpen || !activeTalonSession) {
      return undefined;
    }

    let disposed = false;
    setTalonAgentSession(undefined);
    setTalonAgentError(undefined);
    fetchTalonAgentSession(gameId, activeTalonSession.team, activeTalonSession.role)
      .then((session) => {
        if (!disposed) {
          setTalonAgentSession(session);
        }
      })
      .catch((fetchError: Error) => {
        if (!disposed) {
          setTalonAgentError(fetchError.message);
        }
      });

    return () => {
      disposed = true;
    };
  }, [activeTalonSession, gameId, sessionModalOpen]);

  useEffect(() => {
    if (sessionModalOpen && !activeTalonSession) {
      setSessionModalOpen(false);
    }
  }, [activeTalonSession, sessionModalOpen]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI CodeWords Arena</p>
          <h1>{gameId}</h1>
        </div>
        <div className="topbar-actions">
          {game?.status === 'finished' ? (
            <button
              className="action-button restart-button"
              type="button"
              onClick={handleRestartGame}
              disabled={restartPending}
            >
              {restartPending ? 'Restarting' : 'Restart game'}
            </button>
          ) : (
            <span className={`connection ${connection}`}>{connection}</span>
          )}
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
            <TurnPanel
              game={game}
              onTriggerAgent={handleTriggerAgent}
              onOpenActiveSession={() => setSessionModalOpen(true)}
              triggerPending={triggerPending}
            />
            {showTalonChannelPanel ? (
              <section className="log-panel talon-panel">
                <div className="panel-heading">
                  <h2>Chat</h2>
                  <span>{talonChannel ? `${talonChannel.namespace} / ${talonChannel.channel}` : 'connecting'}</span>
                </div>
                {talonError ? <div className="panel-error">{talonError}</div> : null}
                {talonChannel ? (
                  <div className="talon-channel-viewport">
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
                  </div>
                ) : (
                  <div className="channel-loading">Loading channel</div>
                )}
              </section>
            ) : null}
            <EventLog events={game.events} />
          </aside>
        </div>
      ) : (
        <div className="loading">Loading match</div>
      )}

      {sessionModalOpen && activeTalonSession ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setSessionModalOpen(false)}>
          <section
            className="session-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Active Agent Session</p>
                <h2 id="session-modal-title">{activeTalonSession.agent}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setSessionModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="session-meta">
              <span>{activeTalonSession.namespace}</span>
              <span>{activeTalonSession.sessionId}</span>
            </div>
            {talonAgentError ? <div className="panel-error">{talonAgentError}</div> : null}
            {talonAgentSession ? (
              <TalonCopilot
                className="active-session-copilot"
                gatewayUrl={talonAgentSession.talon.baseUrl}
                authToken={`Bearer ${talonAgentSession.agentToken || talonAgentSession.token}`}
                namespace={activeTalonSession.namespace}
                agent={activeTalonSession.agent}
                sessionId={activeTalonSession.sessionId}
                disabled
                historyMessageLimit={80}
                historyStepLimit={200}
              />
            ) : (
              <div className="channel-loading">Loading active session</div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
