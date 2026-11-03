import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { CommandProbeResult } from '../../dashboard.js';
import type { ModelOffer } from '../../../shared/dashboard.js';
import type { FleetConfig } from '../../config.js';
import { probeKeyPool, readKeyPoolDefinitions } from '../../key-pools.js';
import { createParseContext, type ParsedCliStatus, type DashboardEnrichment, type DashboardEnrichmentContext } from './common.js';

export function parseOpencodeStatus(results: CommandProbeResult[], redact: (text: string) => string): ParsedCliStatus {
  const { result, add } = createParseContext(results, redact);
  let { account, quota, credits } = result;
  for (const result of results) {
    let json: Record<string, unknown>;
    try { json = JSON.parse(result.stdout); if (!json || typeof json !== 'object' || Array.isArray(json)) continue; } catch { continue; }
    if (typeof json.sessions === 'number' && json.tokens && typeof json.tokens === 'object') {
      const tokens=json.tokens as Record<string,unknown>;
      const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString('vi-VN') : '—';
      add('CLI hôm nay · phiên',count(json.sessions));
      add('CLI hôm nay · token vào / ra',`${count(tokens.input)} / ${count(tokens.output)}`);
      if (typeof json.cost === 'number' && json.cost >= 0) add('CLI hôm nay · USD',String(json.cost));
      if (Array.isArray(json.models)) for (const row of json.models) {
        const model=row?.model;if (typeof model?.id === 'string') add('Model đã dùng hôm nay',`${model.providerID ?? ''} / ${model.id}`);
      }
    }
  }
  {
    const auth=results.find(r=>/auth list$/.test(r.command)&&r.ok);
    const entries=auth?.stdout.split(/\r?\n/).filter(line=>/\s+(?:stored|environment)\s*$/.test(line));
    if(entries?.length){account={state:'unknown',label:`${entries.length} kết nối đã cấu hình`,source:auth!.command,reason:'Đã đọc thông tin cấu hình; chưa xác thực hiệu lực của từng credential.'};for(const entry of entries)add('Kết nối CLI',entry.trim());}
  }
  return { ...result, account, quota, credits };
}

// ── enrichment (read-only) ──────────────────────────────────────────────────
interface ModelDetails {
  name: string | null;
  contextTokens: number | null;
}

interface OpencodeSettings {
  /** provider → model key (the part after the first `/`) → display metadata. */
  providers: Map<string, Map<string, ModelDetails>>;
  /** `model` from opencode.json, e.g. `harbor-pool/deepseek-v4.1-flash:free`. */
  model: string | null;
}

const EMPTY_SETTINGS: OpencodeSettings = { providers: new Map(), model: null };

/**
 * `opencode.json` lives next to `key-pool.json`. It only carries provider or
 * model metadata here; credentials in the file are never read or logged.
 */
function readOpencodeSettings(filePath: string): OpencodeSettings {
  if (!filePath || !existsSync(filePath)) return EMPTY_SETTINGS;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return EMPTY_SETTINGS;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_SETTINGS;
  const record = raw as { model?: unknown; provider?: unknown };

  const providers = new Map<string, Map<string, ModelDetails>>();
  const providerRecord = record.provider;
  if (providerRecord && typeof providerRecord === 'object' && !Array.isArray(providerRecord)) {
    for (const [providerId, entry] of Object.entries(providerRecord as Record<string, unknown>)) {
      const modelsRecord = (entry as { models?: unknown } | null)?.models;
      if (!modelsRecord || typeof modelsRecord !== 'object' || Array.isArray(modelsRecord)) continue;
      const models = new Map<string, ModelDetails>();
      for (const [modelKey, modelEntry] of Object.entries(modelsRecord as Record<string, unknown>)) {
        const model = modelEntry as { name?: unknown; limit?: { context?: unknown } } | null;
        const name = typeof model?.name === 'string' && model.name.trim().length > 0 ? model.name.trim() : null;
        const context = model?.limit?.context;
        models.set(modelKey, {
          name,
          contextTokens: typeof context === 'number' && Number.isFinite(context) && context > 0 ? context : null,
        });
      }
      if (models.size > 0) providers.set(providerId, models);
    }
  }
  return { providers, model: typeof record.model === 'string' && record.model.trim().length > 0 ? record.model.trim() : null };
}

/** Split `provider/model` on the first slash and annotate it from opencode.json. */
function parseModels(stdout: string, settings: OpencodeSettings): ModelOffer[] {
  const offers: ModelOffer[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const id = line.trim();
    if (!id || seen.has(id) || /\s/.test(id)) continue;
    seen.add(id);
    const slash = id.indexOf('/');
    const provider = slash > 0 ? id.slice(0, slash) : null;
    const modelKey = slash > 0 ? id.slice(slash + 1) : id;
    const details = provider ? settings.providers.get(provider)?.get(modelKey) : undefined;
    offers.push({
      id,
      label: details?.name ?? id,
      provider,
      multiplier: null,
      contextTokens: details?.contextTokens ?? null,
      source: 'cli',
    });
  }
  return offers;
}

/** `--model` from the Fleet profile wins over the model saved in opencode.json. */
function configuredModel(config: FleetConfig, settings: OpencodeSettings): string | null {
  const args = config.agents.opencode?.extraArgs ?? [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== '--model' && arg !== '-m') continue;
    const value = args[index + 1];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return settings.model;
}

async function readModels(context: DashboardEnrichmentContext, settings: OpencodeSettings): Promise<ModelOffer[] | null> {
  let result;
  try {
    result = await context.runCommand(['models'], 'status');
  } catch {
    return null;
  }
  if (!result.ok) return null;
  return parseModels(result.stdout, settings);
}

async function readKeyPools(configPath: string) {
  if (!configPath) return null;
  const definitions = readKeyPoolDefinitions(configPath);
  if (definitions.length === 0) return null;
  return Promise.all(definitions.map((definition) => probeKeyPool(definition)));
}

/**
 * Read-only enrichment for OpenCode: BYOK plan, model list with context sizes,
 * and local harbor-key pools. Every source is optional; a missing CLI, config
 * file or stopped pool yields absent/`null` data instead of an error.
 */
export async function enrichOpencode(context: DashboardEnrichmentContext): Promise<DashboardEnrichment> {
  const enrichment: DashboardEnrichment = {
    plan: { name: 'BYOK', tier: 'byok', renewsAt: null, source: 'opencode.json' },
  };
  const keyPoolPath = context.config.dashboard?.opencode.keyPoolConfig ?? '';
  const settings = readOpencodeSettings(keyPoolPath ? path.join(path.dirname(keyPoolPath), 'opencode.json') : '');

  const [models, keyPools] = await Promise.all([
    readModels(context, settings).catch(() => null),
    readKeyPools(keyPoolPath).catch(() => null),
  ]);
  if (models !== null) enrichment.models = models;
  if (keyPools !== null) enrichment.keyPools = keyPools;

  const model = configuredModel(context.config, settings);
  if (model !== null) enrichment.currentModel = { id: model, label: model, effort: null };
  return enrichment;
}
