import type { ProtocolMessage } from '@/interfaces/game';

type AgentMessageLogProps = {
  messages: ProtocolMessage[];
};

export function AgentMessageLog({ messages }: AgentMessageLogProps) {
  return (
    <section className="log-panel">
      <h2>Protocol</h2>
      <ol className="message-list">
        {[...messages].reverse().map((message) => (
          <li key={message.id}>
            <div className="message-header">
              <strong>{message.from.team} {message.from.role}</strong>
              <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
            </div>
            <p>{message.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
