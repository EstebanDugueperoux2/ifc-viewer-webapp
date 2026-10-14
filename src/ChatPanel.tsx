import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  DEFAULT_ASSISTANT_URL,
  resetConversation,
  streamChat,
  type AssistantEvent,
  type SaveMode,
} from './assistantClient';
import type { StoredModel } from './modelStore';

interface ChatPanelProps {
  hidden: boolean;
  /** Library model currently open in the viewer, or null. */
  activeModel: StoredModel | null;
  /** Called when the assistant saved a model: the app reloads it in the viewer. */
  onModelSaved: (model: StoredModel) => void;
  onClose: () => void;
}

type ChatItem =
  | { kind: 'user' | 'assistant' | 'error'; text: string }
  | { kind: 'tool'; id: string; name: string; state: 'running' | 'ok' | 'error'; summary?: string };

const SUGGESTIONS = [
  'Create a two-storey 12 x 8 m building with 3 m storeys',
  'How many walls and slabs does this model have?',
  'List the storeys and what they contain',
];

export default function ChatPanel({ hidden, activeModel, onModelSaved, onClose }: ChatPanelProps) {
  const [assistantUrl, setAssistantUrl] = useState(DEFAULT_ASSISTANT_URL);
  const [token, setToken] = useState('');
  const [saveMode, setSaveMode] = useState<SaveMode>('new');
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const conversationId = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [items]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleEvent = useCallback(
    (event: AssistantEvent) => {
      switch (event.type) {
        case 'conversation':
          conversationId.current = event.conversationId;
          break;
        case 'text':
          setItems((previous) => [...previous, { kind: 'assistant', text: event.text }]);
          break;
        case 'tool_use':
          setItems((previous) => [...previous, { kind: 'tool', id: event.id, name: event.name, state: 'running' }]);
          break;
        case 'tool_result':
          setItems((previous) =>
            previous.map((item) =>
              item.kind === 'tool' && item.id === event.id
                ? { ...item, state: event.isError ? 'error' : 'ok', summary: event.summary }
                : item,
            ),
          );
          break;
        case 'model_saved':
          onModelSaved(event.model);
          break;
        case 'error':
          setItems((previous) => [...previous, { kind: 'error', text: event.message }]);
          break;
        default:
          break;
      }
    },
    [onModelSaved],
  );

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || busy) return;
      setInput('');
      setItems((previous) => [...previous, { kind: 'user', text: message }]);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamChat(
          assistantUrl,
          token || undefined,
          { conversationId: conversationId.current, message, modelId: activeModel?.id ?? null, saveMode },
          handleEvent,
          controller.signal,
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          setItems((previous) => [
            ...previous,
            { kind: 'error', text: error instanceof Error ? error.message : 'The assistant is unreachable.' },
          ]);
        }
      } finally {
        // A turn cut short must not leave tool calls spinning forever.
        setItems((previous) => previous.map((item) => (item.kind === 'tool' && item.state === 'running' ? { ...item, state: 'error' } : item)));
        setBusy(false);
        abortRef.current = null;
      }
    },
    [activeModel, assistantUrl, busy, handleEvent, saveMode, token],
  );

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    const id = conversationId.current;
    conversationId.current = undefined;
    setItems([]);
    if (id) void resetConversation(assistantUrl, token || undefined, id);
  }, [assistantUrl, token]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(input);
    }
  };

  return (
    <aside className="chat" hidden={hidden} aria-label="AI assistant">
      <header className="chatHeader">
        <p className="label">Assistant</p>
        <span className="chatHeaderActions">
          <button type="button" onClick={newConversation}>
            New chat
          </button>
          <button type="button" onClick={onClose} aria-label="Hide assistant">
            ×
          </button>
        </span>
      </header>

      <p className="muted chatContext">
        {activeModel
          ? `Model: ${activeModel.name} (from the library)`
          : 'No library model open: ask for a new one, or open/save a model first.'}
      </p>

      <div className="chatMessages" role="log" aria-live="polite">
        {items.length === 0 && (
          <div className="chatEmpty">
            <p className="muted">Create, query and edit IFC models by chatting.</p>
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} type="button" disabled={busy} onClick={() => void send(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {items.map((item, index) =>
          item.kind === 'tool' ? (
            <p key={item.id} className={`chatTool ${item.state}`} title={item.summary}>
              {item.state === 'running' ? '…' : item.state === 'ok' ? '✓' : '✗'} {item.name}
              {item.summary && item.state === 'error' ? `: ${item.summary}` : ''}
            </p>
          ) : (
            <p key={index} className={`chatMessage ${item.kind}`}>
              {item.text}
            </p>
          ),
        )}
        {busy && <p className="chatTool running">Thinking…</p>}
        <div ref={endRef} />
      </div>

      <div className="chatInput">
        <textarea
          value={input}
          rows={3}
          placeholder="Ask the assistant… (Enter to send, Shift+Enter for a new line)"
          aria-label="Message"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="button" disabled={!input.trim()} onClick={() => void send(input)}>
            Send
          </button>
        )}
      </div>

      <details className="chatSettings">
        <summary>Settings</summary>
        <div className="serverConfig">
          <label className="field">
            <span>When the assistant saves</span>
            <select value={saveMode} disabled={busy} onChange={(event) => setSaveMode(event.target.value as SaveMode)}>
              <option value="new">Keep the original, save a copy</option>
              <option value="overwrite">Update the opened model in place</option>
            </select>
          </label>
          <input
            type="text"
            value={assistantUrl}
            disabled={busy}
            aria-label="Assistant URL"
            placeholder="/assistant-api or https://..."
            onChange={(event) => setAssistantUrl(event.target.value)}
          />
          <input
            type="password"
            value={token}
            disabled={busy}
            aria-label="Assistant API token (optional)"
            placeholder="API token (optional)"
            onChange={(event) => setToken(event.target.value)}
          />
        </div>
      </details>
    </aside>
  );
}
