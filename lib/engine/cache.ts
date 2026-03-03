const CACHE_PREFIX = 'vyba_cache_';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

function isLocalStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getCached<T>(key: string): T | null {
  try {
    if (!isLocalStorageAvailable()) return null;

    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;

    const entry: CacheEntry<T> = JSON.parse(raw);

    if (Date.now() - entry.timestamp > entry.ttlMs) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }

    return entry.data;
  } catch {
    return null;
  }
}

export function setCache<T>(key: string, data: T, ttlMs: number): void {
  try {
    if (!isLocalStorageAvailable()) return;

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttlMs,
    };

    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage may be full or unavailable — silently fail
  }
}

export function clearAllCaches(): void {
  try {
    if (!isLocalStorageAvailable()) return;

    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // silently fail
  }
}

export const CACHE_TTL = {
  wikidata: 7 * 24 * 60 * 60 * 1000,     // 7 days
  playlistMining: 24 * 60 * 60 * 1000,    // 24 hours
  resolvedTracks: 24 * 60 * 60 * 1000,    // 24 hours
} as const;

export function getCacheKey(prefix: string, ids: string[]): string {
  return prefix + '_' + ids.sort().join(',').substring(0, 100);
}
