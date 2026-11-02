import { afterEach, describe, expect, test, vi } from 'vitest';

import { api } from '../../web/src/api.js';
import { busUrl } from '../../web/src/ws.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('api', () => {
  test('reads plans with same-origin credentials', async () => {
    const fetchMock = vi.fn(async () => okJson([]));
    vi.stubGlobal('fetch', fetchMock);

    const plans = await api.plans();

    expect(plans).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/plans',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  test('posts JSON actions and parses the response', async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.merge('t-1');

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tasks/t-1/merge',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
  });

  test('tolerates an empty action response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => '',
      })) as unknown as typeof fetch,
    );

    await expect(api.stop('t-1')).resolves.toBeUndefined();
  });

  test('throws with the status when the server rejects a request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'task not found',
      })) as unknown as typeof fetch,
    );

    await expect(api.task('t-404')).rejects.toThrow(/404/);
  });

  test('adds query parameters for event tails', async () => {
    const fetchMock = vi.fn(async () => okJson([]));
    vi.stubGlobal('fetch', fetchMock);

    await api.events('r-1', { afterSeq: 4, tail: 50 });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/runs/r-1/events?afterSeq=4&tail=50',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });
});

describe('busUrl', () => {
  test('uses ws for http and wss for https', () => {
    expect(busUrl({ protocol: 'http:', host: '127.0.0.1:4500' })).toBe(
      'ws://127.0.0.1:4500/ws',
    );
    expect(busUrl({ protocol: 'https:', host: 'fleet.local' })).toBe(
      'wss://fleet.local/ws',
    );
  });
});