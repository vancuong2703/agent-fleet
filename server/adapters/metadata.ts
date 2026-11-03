import type { AgentId, FleetEvent } from '../../shared/types.js';
import type { LineParser } from './types.js';
import { asNumber, asRecord, asString, parseJsonRecord } from './util.js';

type UsageEvent = Extract<FleetEvent, { kind: 'usage' }>;

const asBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

/**
 * Adds reported model identity and Qoder account credits on top of a raw CLI
 * parser. It only reports what the CLI actually states: an unknown model stays
 * unknown, and optional usage fields are omitted unless the source provides
 * them. Usage events emitted by the wrapped parser inherit the current model so
 * the ledger can attribute them.
 */
export function withMetadata(parser: LineParser, agent: AgentId): LineParser {
  let currentModel: string | null = null;
  let currentProvider: string | null = null;
  const seenModels = new Set<string>();
  const creditedMessages = new Set<string>();
  const tokenMessages = new Set<string>();

  const attachIdentity = (event: UsageEvent): void => {
    if (currentModel === null) return;
    event.model = currentModel;
    if (currentProvider !== null) event.provider = currentProvider;
  };

  return (line, stream) => {
    const events: FleetEvent[] = [];
    const record = parseJsonRecord(line);
    if (record) {
      const message = asRecord(record.message);
      const part = asRecord(record.part);
      const modelObject = asRecord(record.model) ?? (part ? asRecord(part.model) : null);
      const model = asString(record.model) ?? (message ? asString(message.model) : undefined)
        ?? (part ? asString(part.modelID) : undefined) ?? (modelObject ? asString(modelObject.modelID) : undefined);
      const provider = asString(record.providerID) ?? (part ? asString(part.providerID) : undefined)
        ?? (modelObject ? asString(modelObject.providerID) : undefined);

      if (model && model.length <= 200) {
        // The active model changes even when its identity was already reported.
        currentModel = model;
        currentProvider = provider ?? null;
        const key = `${provider ?? ''}/${model}`;
        if (!seenModels.has(key)) {
          seenModels.add(key);
          events.push({ kind: 'model', model, source: 'reported', ...(provider ? { provider } : {}) });
        }
      }

      // Qoder's per-message usage carries credits (charged and nominal) and, in
      // some builds, per-message tokens. Repeated streaming snapshots of the same
      // message ID must count once; the result aggregate stays authoritative.
      if (agent === 'qodercli' && record.type === 'assistant' && message) {
        const usage = asRecord(message.usage);
        const id = asString(message.id);
        if (usage && id) {
          const credits = asNumber(usage.credits);
          const billable = asBoolean(usage.billable);
          const nominal = asNumber(usage.original_credits) ?? credits;
          const charged = billable === false ? 0 : credits;
          const hasCredits = (credits !== undefined && credits >= 0) || (nominal !== undefined && nominal >= 0);
          if (hasCredits && !creditedMessages.has(id)) {
            creditedMessages.add(id);
            const event: UsageEvent = { kind: 'usage', usageId: id, usageScope: 'delta' };
            if (charged !== undefined && charged >= 0) event.credits = charged;
            if (nominal !== undefined && nominal >= 0) event.reportedCredits = nominal;
            if (billable !== undefined) event.billable = billable;
            attachIdentity(event);
            events.push(event);
          }

          // Per-message token/cost only assigns a model; the run total comes from
          // the result aggregate, so these must never be charged twice.
          const inputTokens = asNumber(usage.input_tokens);
          const outputTokens = asNumber(usage.output_tokens);
          if (((inputTokens ?? 0) > 0 || (outputTokens ?? 0) > 0) && !tokenMessages.has(id)) {
            tokenMessages.add(id);
            const tokenEvent: UsageEvent = { kind: 'usage', usageId: `${id}:tokens`, usageScope: 'delta', attributionOnly: true };
            if (inputTokens !== undefined) tokenEvent.inputTokens = inputTokens;
            if (outputTokens !== undefined) tokenEvent.outputTokens = outputTokens;
            attachIdentity(tokenEvent);
            events.push(tokenEvent);
          }
        }
      }

      // A final result may state the authoritative charged credit total.
      if (record.type === 'result') {
        const resultUsage = asRecord(record.usage);
        const total = asNumber(record.total_credits) ?? (resultUsage ? asNumber(resultUsage.credits) : undefined);
        if (total !== undefined && total >= 0) {
          // Run-level totals are unattributed; per-message rows carry the models.
          events.push({ kind: 'usage', credits: total, usageScope: 'cumulative', usageId: 'result' });
        }
        // Every model named in modelUsage is reported, even without a run total.
        const modelUsage = asRecord(record.modelUsage);
        for (const name of modelUsage ? Object.keys(modelUsage) : []) {
          if (!name || name.length > 200 || seenModels.has(`/${name}`)) continue;
          seenModels.add(`/${name}`);
          events.push({ kind: 'model', model: name, source: 'reported' });
        }
      }
    }

    // A result record is the run aggregate: it stays unattributed so the
    // per-message model rows are not duplicated by the run total.
    const aggregate = record !== null && (record.type === 'result' || record.event === 'result');
    const parsed = parser(line, stream).map((event): FleetEvent => {
      if (event.kind !== 'usage' || event.model !== undefined || currentModel === null || aggregate) return event;
      return { ...event, model: currentModel, ...(currentProvider !== null ? { provider: currentProvider } : {}) };
    });
    return [...events, ...parsed];
  };
}

/** Last explicit model flag wins; a configured value is distinct from a report. */
export function configuredModel(args: string[]): string | null {
  let model: string | null = null;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if ((arg === '-m' || arg === '--model') && args[index + 1] && !args[index + 1]!.startsWith('-')) model = args[++index]!;
    else if (arg.startsWith('--model=')) model = arg.slice('--model='.length) || null;
    else if (arg === '-c' || arg === '--config') {
      const match = /^model\s*=\s*["']?([^"']+?)["']?$/.exec(args[index + 1] ?? '');
      if (match) { model = match[1]!.trim(); index++; }
    }
  }
  return model;
}
