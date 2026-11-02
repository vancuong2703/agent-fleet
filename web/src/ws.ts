import type { BusMsg } from '../../shared/types.js';

export interface BusHandlers {
  onMessage: (message: BusMsg) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (event: Event) => void;
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

  const open = (): void => {
    socket = new WebSocket(busUrl());

    socket.onopen = () => {
      attempt = 0;
      handlers.onOpen?.();
    };

    socket.onmessage = (event) => {
      try {
        handlers.onMessage(JSON.parse(String(event.data)) as BusMsg);
      } catch {
        // Ignore a malformed frame; the next one still arrives.
      }
    };

    socket.onerror = (event) => {
      handlers.onError?.(event);
    };

    socket.onclose = () => {
      handlers.onClose?.();
      if (closed) return;
      const delay = Math.min(5_000, 500 * 2 ** attempt);
      attempt += 1;
      window.setTimeout(open, delay);
    };
  };

  open();

  return () => {
    closed = true;
    socket?.close();
  };
}
