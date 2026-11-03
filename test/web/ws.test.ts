import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { busUrl, connectBus } from '../../web/src/ws.js';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (()=>void) | null = null;
  onclose: (()=>void) | null = null;
  onerror: ((event: Event)=>void) | null = null;
  onmessage: ((event: {data:string})=>void) | null = null;
  close = vi.fn(() => this.onclose?.());
  constructor(public url: string) { FakeSocket.instances.push(this); }
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal('window', { location:{protocol:'http:',host:'127.0.0.1:4500'},setTimeout,clearTimeout });
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {vi.useRealTimers();vi.unstubAllGlobals();});

describe('live bus reconnection', () => {
  test('chooses secure websocket on HTTPS', () => {
    expect(busUrl({protocol:'https:',host:'example.test'})).toBe('wss://example.test/ws');
  });
  test('unmount cancels queued reconnect and stale callbacks cannot create sockets', () => {
    const stop = connectBus({onMessage:vi.fn()});
    const first = FakeSocket.instances[0]!;
    first.onclose?.();
    stop();
    vi.advanceTimersByTime(60_000);
    first.onclose?.();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  test('reconnects, resets backoff after open and ignores malformed messages', () => {
    const onMessage = vi.fn();
    const onOpen = vi.fn();
    const stop = connectBus({onMessage,onOpen});
    FakeSocket.instances[0]!.onclose?.();
    vi.advanceTimersByTime(500);
    const second = FakeSocket.instances[1]!;
    second.onopen?.();
    second.onmessage?.({data:'invalid'});
    second.onmessage?.({data:'{}'});
    second.onmessage?.({data:'{"type":"future-message"}'});
    second.onmessage?.({data:'{"type":"event","taskId":"t","stored":{}}'});
    second.onmessage?.({data:'{"type":"plan","plan":{"id":"p"}}'});
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
    FakeSocket.instances[0]!.onmessage?.({data:'{"type":"plan"}'});
    expect(onMessage).toHaveBeenCalledTimes(1);
    second.onclose?.();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(3);
    stop();
  });
});
