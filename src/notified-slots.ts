/**
 * Persist dedup уведомлений о слотах (переживает рестарт процесса).
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const NOTIFIED_FILE = join(process.cwd(), '.notified-slots.json');
const TTL_MS = 24 * 60 * 60 * 1000;

interface NotifiedEntry {
  key: string;
  notifiedAt: number;
}

function loadEntries(): NotifiedEntry[] {
  if (!existsSync(NOTIFIED_FILE)) return [];

  try {
    const raw = readFileSync(NOTIFIED_FILE, 'utf-8').trim();
    if (!raw) return [];

    const data = JSON.parse(raw) as NotifiedEntry[];
    if (!Array.isArray(data)) return [];

    const cutoff = Date.now() - TTL_MS;
    return data.filter((e) => e.key && e.notifiedAt >= cutoff);
  } catch {
    return [];
  }
}

function saveEntries(entries: NotifiedEntry[]): void {
  try {
    writeFileSync(NOTIFIED_FILE, JSON.stringify(entries, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

export function loadNotifiedKeys(): Set<string> {
  return new Set(loadEntries().map((e) => e.key));
}

export function isSlotNotified(key: string, knownKeys?: Set<string>): boolean {
  const keys = knownKeys ?? loadNotifiedKeys();
  return keys.has(key);
}

export function markSlotsNotified(keys: string[], knownKeys: Set<string>): void {
  const now = Date.now();
  const cutoff = now - TTL_MS;
  const entries = loadEntries().filter((e) => e.notifiedAt >= cutoff);

  for (const key of keys) {
    if (!knownKeys.has(key)) {
      entries.push({ key, notifiedAt: now });
      knownKeys.add(key);
    }
  }

  saveEntries(entries);
}
