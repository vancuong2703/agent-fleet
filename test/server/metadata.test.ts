import { describe, expect, test } from 'vitest';
import type { FleetEvent } from '../../shared/types.js';
import { configuredModel, withMetadata } from '../../server/adapters/metadata.js';
import { getAdapter } from '../../server/adapters/index.js';

const usage = (events: FleetEvent[]) => events.filter((event) => event.kind === 'usage');

describe('explicit model and provider usage metadata', () => {
  test('records configuration without guessing and last flag wins', () => {
    expect(configuredModel([])).toBeNull();
    expect(configuredModel(['--model', 'small', '-c', 'model="larger"'])).toBe('larger');
    expect(configuredModel(['-m', 'one', '--model=two'])).toBe('two');
    expect(configuredModel(['--model', '--json'])).toBeNull();
  });

  test('reported model changes are emitted once while normal parser output survives', () => {
    const parse = withMetadata(getAdapter('qodercli').createParser(), 'qodercli');
    const line = (model: string, text: string) => JSON.stringify({ type: 'assistant', message: { model, content: [{ type: 'text', text }] } });
    expect(parse(line('qwen-small', 'hello'), 'stdout')).toEqual([
      { kind: 'model', model: 'qwen-small', source: 'reported' }, { kind: 'message', text: 'hello' },
    ]);
    expect(parse(line('qwen-small', 'next'), 'stdout')).toEqual([{ kind: 'message', text: 'next' }]);
    expect(parse(line('qwen-large', 'last'), 'stdout')[0]).toMatchObject({ kind: 'model', model: 'qwen-large' });
  });

  test('an init model and a runtime model are both retained without aliasing', () => {
    const parse = withMetadata(getAdapter('qodercli').createParser(), 'qodercli');
    const init = JSON.stringify({ type: 'system', subtype: 'init', model: 'Qwen3.8-Flash', session_id: 's1' });
    expect(parse(init, 'stdout')).toEqual([
      { kind: 'model', model: 'Qwen3.8-Flash', source: 'reported' }, { kind: 'session', id: 's1' },
    ]);
    const message = JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'qfmodel', usage: { credits: 0, billable: false }, content: [] } });
    const events = parse(message, 'stdout');
    expect(events[0]).toEqual({ kind: 'model', model: 'qfmodel', source: 'reported' });
    expect(events[1]).toMatchObject({ kind: 'usage', credits: 0, reportedCredits: 0, billable: false, usageId: 'm1', model: 'qfmodel' });
  });

  test('Qoder credits are deduplicated by message ID; zero counts and negatives are dropped', () => {
    const parse = withMetadata(getAdapter('qodercli').createParser(), 'qodercli');
    const line = (id: string, credits?: number, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ type: 'assistant', message: { id, model: 'qfmodel', usage: { credits, ...extra }, content: [] } });
    expect(usage(parse(line('one'), 'stdout'))).toHaveLength(0);
    expect(usage(parse(line('one', 0.25), 'stdout'))[0]).toMatchObject({ kind: 'usage', credits: 0.25, reportedCredits: 0.25, usageId: 'one', model: 'qfmodel' });
    expect(usage(parse(line('one', 0.25), 'stdout'))).toHaveLength(0);
    expect(usage(parse(line('zero', 0), 'stdout'))).toHaveLength(1);
    expect(usage(parse(line('negative', -1), 'stdout'))).toHaveLength(0);
    expect(usage(parse(line('nonbillable', 0.17, { billable: false, original_credits: 0.17 }), 'stdout'))[0])
      .toMatchObject({ credits: 0, reportedCredits: 0.17, billable: false });
  });

  test('Qoder per-message tokens are attributionOnly and the result total overrides charged credits', () => {
    const parse = withMetadata(getAdapter('qodercli').createParser(), 'qodercli');
    const message = parse(JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'qfmodel', usage: { credits: 2, billable: true, input_tokens: 7, output_tokens: 3 }, content: [] } }), 'stdout');
    expect(message).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'usage', credits: 2, reportedCredits: 2, model: 'qfmodel' }),
      expect.objectContaining({ kind: 'usage', inputTokens: 7, outputTokens: 3, attributionOnly: true, model: 'qfmodel' }),
    ]));
    const result = parse(JSON.stringify({ type: 'result', total_credits: 0, usage: { input_tokens: 5, output_tokens: 1 } }), 'stdout');
    expect(result).toEqual(expect.arrayContaining([
      { kind: 'usage', credits: 0, usageScope: 'cumulative', usageId: 'result' },
      { kind: 'usage', inputTokens: 5, outputTokens: 1 },
    ]));
  });

  test('usage events inherit the current model and provider without inventing fields', () => {
    const parse = withMetadata(getAdapter('opencode').createParser(), 'opencode');
    expect(parse(JSON.stringify({ type: 'step_start', part: { model: { modelID: 'small', providerID: 'vendor' } } }), 'stdout'))
      .toEqual(expect.arrayContaining([{ kind: 'model', model: 'small', provider: 'vendor', source: 'reported' }]));
    expect(usage(parse(JSON.stringify({ type: 'step_finish', part: { cost: 0.5, tokens: { input: 10, output: 2 } } }), 'stdout'))[0])
      .toEqual({ kind: 'usage', inputTokens: 10, outputTokens: 2, costUsd: 0.5, model: 'small', provider: 'vendor' });
  });

  test('Codex usage without model metadata stays unknown and keeps unparsed lines raw', () => {
    const parse = withMetadata(getAdapter('codex').createParser(), 'codex');
    expect(parse(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 1 } }), 'stdout'))
      .toEqual([{ kind: 'usage', inputTokens: 5, outputTokens: 1 }]);
    expect(parse('unstructured text', 'stderr')).toEqual([{ kind: 'raw', stream: 'stderr', text: 'unstructured text' }]);
  });

  test('OpenCode provider/model object is preserved and never guessed', () => {
    const parse = withMetadata(getAdapter('opencode').createParser(), 'opencode');
    expect(parse('{"type":"step_start","part":{"model":{"modelID":"small","providerID":"vendor"}}}', 'stdout')[0])
      .toEqual({ kind: 'model', model: 'small', provider: 'vendor', source: 'reported' });
  });
});
