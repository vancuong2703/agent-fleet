import type { BusMsg } from '../../shared/types.js';

export interface BusHandlers {
  onMessage: (message: BusMsg) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (event: Event) => void;
}

function isMessage(value: unknown): value is BusMsg {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  if (data.type === 'event') {
    const stored = data.stored as Record<string, unknown> | undefined;
    const event = stored?.event as Record<string, unknown> | undefined;
    return typeof data.taskId === 'string' && typeof stored?.runId === 'string'
      && typeof stored.seq === 'number' && Number.isSafeInteger(stored.seq) && stored.seq >= 0
      && typeof stored.ts === 'number' && Number.isFinite(stored.ts) && typeof event?.kind === 'string'
      && ['message', 'command', 'file_edit', 'tool', 'usage', 'model', 'session', 'error', 'raw', 'status', 'check'].includes(event.kind);
  }
  if (data.type !== 'task' && data.type !== 'run' && data.type !== 'plan') return false;
  const item = data[data.type] as Record<string, unknown> | undefined;
  return Boolean(item && typeof item.id === 'string');
}

/**
 * WebSocket URL for the server's event bus. Same host as the page so the
 * `fleet_token` cookie is sent along with the upgrade request.
 */
export function busUrl(location: { protocol: string; host: string } = window.location): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws`;
}

/**
 * Connect to `WS /ws` and keep reconnecting until the returned function is
 * called. Messages are `BusMsg` JSON; anything unparsable is ignored so one bad
 * frame never tears the stream down.
 */
export function connectBus(handlers: BusHandlers): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimer: number | undefined;

  const open = (): void => {
    if (closed) return;
    const current = new WebSocket(busUrl());
    socket = current;

    current.onopen = () => {
      if (closed || socket !== current) return;
      attempt = 0;
      handlers.onOpen?.();
    };

    current.onmessage = (event) => {
      if (closed || socket !== current) return;
      try {
        const message: unknown = JSON.parse(String(event.data));
        if (isMessage(message)) handlers.onMessage(message);
      } catch {
        // Ignore a malformed frame; the next one still arrives.
      }
    };

    current.onerror = (event) => {
      if (closed || socket !== current) return;
      handlers.onError?.(event);
      // A transport error may arrive without a close until the network times out.
      current.close();
    };

    current.onclose = () => {
      if (closed || socket !== current) return;
      handlers.onClose?.();
      const delay = Math.min(5_000, 500 * 2 ** attempt);
      attempt += 1;
      reconnectTimer = window.setTimeout(open, delay);
    };
  };

  open();

  return () => {
    closed = true;
    window.clearTimeout(reconnectTimer);
    socket?.close();
  };
}
