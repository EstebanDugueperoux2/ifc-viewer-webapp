import type { StoredModel } from './modelStore';

/**
 * Client for the `assistant` service of the companion ifc-server repo. In dev, Vite proxies
 * `/assistant-api` to it (see vite.config.ts). Override with VITE_ASSISTANT_URL for deployed builds.
 */
export const DEFAULT_ASSISTANT_URL: string =
  (import.meta.env.VITE_ASSISTANT_URL as string | undefined) ?? '/assistant-api';

export type SaveMode = 'new' | 'overwrite';

export type AssistantEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; isError: boolean; summary: string }
  | { type: 'model_saved'; model: StoredModel }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface ChatRequest {
  conversationId?: string;
  message: string;
  /** Stored model open in the viewer, or null when none is. */
  modelId: string | null;
  saveMode: SaveMode;
}

const root = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');
const authHeaders = (token?: string): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

/** Sends one message and calls `onEvent` for every streamed event until the server closes the stream. */
export async function streamChat(
  baseUrl: string,
  token: string | undefined,
  request: ChatRequest,
  onEvent: (event: AssistantEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${root(baseUrl)}/api/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) {
    let detail = '';
    try {
      detail = ((await response.json()) as { error?: string }).error ?? '';
    } catch {
      /* body is not JSON */
    }
    throw new Error(detail || `Assistant error (HTTP ${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const line = block.split('\n').find((candidate) => candidate.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)) as AssistantEvent);
    }
  }
}

/** Best effort: lets the server free the conversation's resources. */
export async function resetConversation(baseUrl: string, token: string | undefined, id: string): Promise<void> {
  try {
    await fetch(`${root(baseUrl)}/api/v1/conversations/${id}`, { method: 'DELETE', headers: authHeaders(token) });
  } catch {
    /* the server expires idle conversations anyway */
  }
}
