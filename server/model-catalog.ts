import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.js';
import type { ModelOffer } from '../shared/dashboard.js';

/** User-editable file in the Fleet data dir; the only source of rates when the CLI screen has none. */
export const MODEL_CATALOG_FILE = 'model-catalog.json';

export interface ModelCatalogEntry {
  id: string;
  label?: string;
  /** null = the catalog gives no usable rate; never means "free". */
  multiplier: number | null;
  originalMultiplier?: number | null;
  promo?: string | null;
  contextTokens?: number | null;
  provider?: string | null;
}

export interface ModelCatalog {
  file: string;
  found: boolean;
  /** Verbatim `verifiedAt` from the file so the UI can say when the rates were checked. */
  verifiedAt: string | null;
  entries: ModelCatalogEntry[];
  /** Why the file could not be used; null when absent or valid. */
  error: string | null;
}

/** Case/space/punctuation-insensitive identity, so `qwen3.8 MAX` matches `Qwen3.8-Max`. */
export const modelKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const MAX_MULTIPLIER = 1000;

/** Accepts JSON numbers and plain numeric strings; anything else stays unknown. */
function rate(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value
    : typeof value === 'string' && /^\s*\d+(?:\.\d+)?\s*$/.test(value) ? Number(value.trim()) : Number.NaN;
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= MAX_MULTIPLIER ? numeric : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function tokens(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*([km])?$/i);
  if (!match) return null;
  const scale = match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1;
  return Math.round(Number(match[1]) * scale);
}

function entryFrom(id: string, fields: Record<string, unknown>): ModelCatalogEntry | null {
  const label = text(fields.label) ?? text(fields.name) ?? id;
  const entry: ModelCatalogEntry = { id, label, multiplier: rate(fields.multiplier ?? fields.rate ?? fields.credit) };
  const original = rate(fields.originalMultiplier ?? fields.original ?? fields.originalRate);
  const promo = text(fields.promo ?? fields.promoLabel);
  const contextTokens = tokens(fields.contextTokens ?? fields.context);
  const provider = text(fields.provider);
  if (original !== null) entry.originalMultiplier = original;
  if (promo !== null) entry.promo = promo;
  if (contextTokens !== null) entry.contextTokens = contextTokens;
  if (provider !== null) entry.provider = provider;
  return entry;
}

/**
 * Reads `<FLEET_DATA_DIR>/model-catalog.json`. Both shapes a person is likely to
 * hand-write are accepted: `{"models": {"Name": {...}}}` and `{"models": [{"id": "Name", ...}]}`,
 * as well as a bare array. Reading never creates or repairs the file.
 */
export function readModelCatalog(directory: string = dataDir()): ModelCatalog {
  const file = path.join(directory, MODEL_CATALOG_FILE);
  const empty: ModelCatalog = { file, found: false, verifiedAt: null, entries: [], error: null };
  if (!existsSync(file)) return empty;

  let raw: string;
  try { raw = readFileSync(file, 'utf8'); }
  catch { return { ...empty, found: true, error: 'Không đọc được file catalog (quyền truy cập).' }; }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return { ...empty, found: true, error: `File ${MODEL_CATALOG_FILE} không phải JSON hợp lệ.` }; }

  const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : { models: parsed };
  const verifiedAt = text(root.verifiedAt ?? root.updatedAt ?? root.verified_at);
  const models = root.models;
  const rows: [string, Record<string, unknown>][] = [];
  if (Array.isArray(models)) {
    for (const item of models) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const fields = item as Record<string, unknown>;
      const id = text(fields.id) ?? text(fields.model) ?? text(fields.name);
      if (id) rows.push([id, fields]);
    }
  } else if (models && typeof models === 'object') {
    for (const [id, value] of Object.entries(models as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const fields = value as Record<string, unknown>;
      rows.push([text(fields.id) ?? id, fields]);
    }
  } else if (models !== undefined) {
    return { ...empty, found: true, verifiedAt, error: `Mục "models" trong ${MODEL_CATALOG_FILE} phải là đối tượng hoặc mảng.` };
  }

  const entries = rows.map(([id, fields]) => entryFrom(id, fields)).filter((entry): entry is ModelCatalogEntry => entry !== null);
  return { file, found: true, verifiedAt, entries, error: null };
}

/** Overrides known offers with catalog rates and appends catalog-only models. */
export function applyModelCatalog(models: ModelOffer[], catalog: ModelCatalog): ModelOffer[] {
  if (catalog.entries.length === 0) return models;
  const pending = new Map<string, ModelCatalogEntry>();
  for (const entry of catalog.entries) pending.set(modelKey(entry.id), entry);

  const merged = models.map((model) => {
    const entry = pending.get(modelKey(model.id));
    if (!entry) return model;
    pending.delete(modelKey(model.id));
    const multiplier = entry.multiplier ?? model.multiplier;
    const originalMultiplier = entry.originalMultiplier ?? model.originalMultiplier;
    const promo = entry.promo ?? model.promo;
    const contextTokens = entry.contextTokens ?? model.contextTokens;
    const provider = entry.provider ?? model.provider;
    const changed = multiplier !== model.multiplier || originalMultiplier !== model.originalMultiplier
      || promo !== model.promo || contextTokens !== model.contextTokens || provider !== model.provider;
    if (!changed) return model;
    return { ...model, multiplier, originalMultiplier, promo, contextTokens, provider, source: 'catalog' as const };
  });

  for (const entry of pending.values()) {
    merged.push({
      id: entry.id, label: entry.label ?? entry.id, provider: entry.provider ?? null,
      multiplier: entry.multiplier, originalMultiplier: entry.originalMultiplier ?? null,
      promo: entry.promo ?? null, contextTokens: entry.contextTokens ?? null, source: 'catalog',
    });
  }
  return merged;
}

/** `dd/mm` for the "theo catalog, cập nhật dd/mm" note; null when the file gives no usable date. */
export function formatVerifiedAt(verifiedAt: string | null): string | null {
  if (!verifiedAt) return null;
  const stamp = Date.parse(verifiedAt);
  if (!Number.isFinite(stamp)) return null;
  const date = new Date(stamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}`;
}
