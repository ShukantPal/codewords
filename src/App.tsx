import { useEffect, useRef, useState } from 'react';
import { TalonChannel, TalonCopilot } from '@talonai/copilot';
import type { ArenaProjection } from '@/interfaces/arena';
import type { AgentRole, SpectatorProjection, TalonActiveSession, Team } from '@/interfaces/game';
import { Board } from './components/Board';
import { EventLog } from './components/EventLog';
import { ScoreStrip } from './components/ScoreStrip';
import { TurnPanel } from './components/TurnPanel';
import {
  createArenaGames,
  fetchArena,
  fetchSpectatorGame,
  fetchTalonAgentSession,
  fetchTalonChannelSession,
  INITIAL_ARENA_ID,
  INITIAL_GAME_ID,
  restartGame,
  subscribeToArena,
  subscribeToGame,
  triggerCurrentAgent,
  type TalonAgentSession,
  type TalonChannelSession,
} from './client/codewordsClient';
import './styles.css';

type ConnectionState = 'connecting' | 'live' | 'error';
const showTalonChannelPanel = true;

function GenericBotIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="8" width="14" height="11" rx="3" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 13h.01M15 13h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M10 17h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function replaceAssistantLabels(root: HTMLElement, label: string): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.textContent === 'Talon') {
      nodes.push(node as Text);
    }
    node = walker.nextNode();
  }
  for (const textNode of nodes) {
    textNode.textContent = label;
  }
}

function parseAgentName(agent: string): { team: Team; role: AgentRole } | undefined {
  const match = agent.match(/^(blue|red)-(spymaster|guesser)$/);
  if (!match) {
    return undefined;
  }
  return {
    team: match[1] as Team,
    role: match[2] as AgentRole,
  };
}

export default function App() {
  const [arenaId] = useState(INITIAL_ARENA_ID);
  const [gameId, setGameId] = useState(INITIAL_GAME_ID);
  const [arena, setArena] = useState<ArenaProjection | undefined>();
  const [showKey, setShowKey] = useState(false);
  const [game, setGame] = useState<SpectatorProjection | undefined>();
  const [talonChannel, setTalonChannel] = useState<TalonChannelSession | undefined>();
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | undefined>();
  const [talonError, setTalonError] = useState<string | undefined>();
  const [triggerPending, setTriggerPending] = useState(false);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [selectedTalonSession, setSelectedTalonSession] = useState<TalonActiveSession | undefined>();
  const [talonAgentSession, setTalonAgentSession] = useState<TalonAgentSession | undefined>();
  const [talonAgentError, setTalonAgentError] = useState<string | undefined>();
  const [restartPending, setRestartPending] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const sessionModalBodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    fetchArena(arenaId)
      .then((snapshot) => {
        if (!disposed) {
          setArena(snapshot);
        }
      })
      .catch((fetchError: Error) => {
        if (!disposed) {
          setError(fetchError.message);
        }
      });

    const unsubscribe = subscribeToArena(
      arenaId,
      (snapshot) => {
        if (!disposed) {
          setArena(snapshot);
        }
      },
      (socketError) => {
        if (!disposed) {
          setError(socketError.message);
        }
      },
    );

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [arenaId]);

  useEffect(() => {
    let disposed = false;
    setConnection('connecting');
    setError(undefined);

    fetchSpectatorGame(arenaId, gameId, showKey)
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
      arenaId,
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
  }, [arenaId, gameId, showKey]);

  useEffect(() => {
    if (!showTalonChannelPanel) {
      return undefined;
    }
    let disposed = false;
    setTalonError(undefined);
    fetchTalonChannelSession(arenaId, gameId)
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
  }, [arenaId, gameId]);

  const handleTriggerAgent = () => {
    setTriggerPending(true);
    setError(undefined);
    triggerCurrentAgent(arenaId, gameId, showKey)
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
    restartGame(arenaId, gameId)
      .then((snapshot) => {
        setGame(snapshot);
        setConnection('live');
        setSessionModalOpen(false);
        setSelectedTalonSession(undefined);
        setTalonAgentSession(undefined);
      })
      .catch((restartError: Error) => {
        setError(restartError.message);
      })
      .finally(() => {
        setRestartPending(false);
      });
  };

  const handleCreateGames = () => {
    setCreatePending(true);
    setError(undefined);
    createArenaGames(arenaId, 4)
      .then((snapshot) => {
        setArena(snapshot);
        if (snapshot.games[0]) {
          setGameId(snapshot.games[0].gameId);
        }
      })
      .catch((createError: Error) => {
        setError(createError.message);
      })
      .finally(() => {
        setCreatePending(false);
      });
  };

  const activeTalonSession = game?.activeTalonSession;
  const talonSessionByTriggerMessageId = new Map(
    (game?.talonTriggerSessions ?? [])
      .filter((session) => session.triggerMessageId)
      .map((session) => [session.triggerMessageId as string, session]),
  );

  const openTalonSession = (session: TalonActiveSession) => {
    setSelectedTalonSession(session);
    setSessionModalOpen(true);
  };

  useEffect(() => {
    if (!sessionModalOpen || !selectedTalonSession) {
      return undefined;
    }

    let disposed = false;
    setTalonAgentSession(undefined);
    setTalonAgentError(undefined);
    fetchTalonAgentSession(arenaId, gameId, selectedTalonSession.team, selectedTalonSession.role)
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
  }, [arenaId, gameId, selectedTalonSession, sessionModalOpen]);

  useEffect(() => {
    const root = sessionModalBodyRef.current;
    if (!root || !selectedTalonSession) {
      return undefined;
    }

    replaceAssistantLabels(root, selectedTalonSession.agent);
    const observer = new MutationObserver(() => replaceAssistantLabels(root, selectedTalonSession.agent));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [selectedTalonSession, talonAgentSession]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">AI CodeWords Arena</p>
          <h1>{arenaId}</h1>
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
          <button className="action-button" type="button" onClick={handleCreateGames} disabled={createPending}>
            {createPending ? 'Creating' : 'Create 4 games'}
          </button>
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

      <section className="arena-panel">
        <div className="panel-heading">
          <h2>Leaderboard</h2>
          <span className="muted-label">{arena?.games.length ?? 0} games</span>
        </div>
        {arena && arena.leaderboard.length > 0 ? (
          <div className="leaderboard-grid">
            {arena.leaderboard.map((entry) => (
              <div className="leaderboard-row" key={entry.modelId}>
                <strong>{entry.provider} / {entry.model}</strong>
                <span>{entry.wins}-{entry.losses}</span>
                <span>{Math.round(entry.winRate * 100)}%</span>
                <span>{entry.illegalMoves} illegal</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="channel-loading">No scored games yet.</div>
        )}
      </section>

      <section className="arena-panel">
        <div className="panel-heading">
          <h2>Games</h2>
          <span className="muted-label">Live arena</span>
        </div>
        {arena && arena.games.length > 0 ? (
          <div className="games-grid">
            {arena.games.map((summary) => (
              <button
                className={`game-row ${summary.gameId === gameId ? 'is-selected' : ''}`}
                key={summary.gameId}
                type="button"
                onClick={() => setGameId(summary.gameId)}
              >
                <strong>{summary.gameId}</strong>
                <span>{summary.status}{summary.winner ? ` · ${summary.winner} won` : ''}</span>
                <span>Blue {summary.scores.blue.wordsRevealed}/{summary.scores.blue.wordsTotal}</span>
                <span>Red {summary.scores.red.wordsRevealed}/{summary.scores.red.wordsTotal}</span>
                <span>{summary.activeAgent ? `${summary.activeAgent.team}-${summary.activeAgent.role}` : 'finished'}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="channel-loading">Create games to populate the arena dashboard.</div>
        )}
      </section>

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
              onOpenActiveSession={() => {
                if (activeTalonSession) {
                  openTalonSession(activeTalonSession);
                }
              }}
              triggerPending={triggerPending}
            />
            {showTalonChannelPanel ? (
              <section className="log-panel talon-panel">
                <div className="panel-heading">
                  <h2>Chat</h2>
                  <a
                    className="powered-by-talon"
                    href="https://github.com/impalasys/talon"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>Powered by Talon</span>
                    <span aria-hidden="true" className="external-link-icon">↗</span>
                  </a>
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
                        const triggerSession = message.id ? talonSessionByTriggerMessageId.get(message.id) : undefined;
                        const sourceAgentRef = sourceAgent ? parseAgentName(sourceAgent) : undefined;
                        const sourceSession = sourceAgent && sourceSessionId && sourceAgentRef
                          ? {
                              namespace: talonChannel.namespace,
                              channel: talonChannel.channel,
                              agent: sourceAgent,
                              team: sourceAgentRef.team,
                              role: sourceAgentRef.role,
                              sessionId: sourceSessionId,
                              reason: 'channel-message',
                              triggeredAt: Date.now(),
                            } satisfies TalonActiveSession
                          : undefined;
                        if (!triggerSession && !sourceSession) {
                          return null;
                        }
                        return (
                          <div className="message-actions">
                            {triggerSession ? (
                              <button
                                className="session-chip"
                                type="button"
                                onClick={() => openTalonSession(triggerSession)}
                              >
                                Thought process
                              </button>
                            ) : null}
                            {sourceSession ? (
                              <button
                                className="session-chip"
                                type="button"
                                onClick={() => openTalonSession(sourceSession)}
                              >
                                {sourceAgent}
                              </button>
                            ) : null}
                          </div>
                        );
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

      {sessionModalOpen && selectedTalonSession ? (
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
                <h2 id="session-modal-title">{selectedTalonSession.agent}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setSessionModalOpen(false)}>
                Close
              </button>
            </div>
            <div className="session-meta">
              <span>{selectedTalonSession.namespace}</span>
              <span>{selectedTalonSession.sessionId}</span>
            </div>
            <div className="session-modal-body" ref={sessionModalBodyRef}>
              {talonAgentError ? <div className="panel-error">{talonAgentError}</div> : null}
              {talonAgentSession ? (
                <TalonCopilot
                  className="active-session-copilot"
                  gatewayUrl={talonAgentSession.talon.baseUrl}
                  authToken={`Bearer ${talonAgentSession.agentToken || talonAgentSession.token}`}
                  namespace={selectedTalonSession.namespace}
                  agent={selectedTalonSession.agent}
                  sessionId={selectedTalonSession.sessionId}
                  disabled
                  talonIcon={<GenericBotIcon />}
                  placeholder={`Ask ${selectedTalonSession.agent} to perform a task...`}
                  historyMessageLimit={80}
                  historyStepLimit={200}
                />
              ) : (
                <div className="channel-loading">Loading active session</div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
