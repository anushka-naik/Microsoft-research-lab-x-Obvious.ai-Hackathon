// Multi-provider bring-your-own-key store. Keys live only in the browser's
// localStorage and are sent directly from the client to each provider — the
// same model the app already uses for Gemini.

export type ProviderId = 'gemini' | 'fal' | 'replicate';

/** Stable storage keys. `gemini` keeps its legacy name so existing keys survive the update. */
const STORAGE_KEYS: Record<ProviderId, string> = {
  gemini: 'syncro_gemini_api_key',
  fal: 'syncro_fal_api_key',
  replicate: 'syncro_replicate_api_token',
};

export function getProviderKey(provider: ProviderId): string {
  return localStorage.getItem(STORAGE_KEYS[provider]) ?? '';
}

export function setProviderKey(provider: ProviderId, key: string): void {
  if (key.trim()) {
    localStorage.setItem(STORAGE_KEYS[provider], key.trim());
  } else {
    localStorage.removeItem(STORAGE_KEYS[provider]);
  }
}

export function hasProviderKey(provider: ProviderId): boolean {
  return !!localStorage.getItem(STORAGE_KEYS[provider]);
}

// ── Legacy Gemini aliases (existing callers keep working) ──────────────────

export function getApiKey(): string {
  return getProviderKey('gemini');
}

export function setApiKey(key: string): void {
  setProviderKey('gemini', key);
}

export function hasApiKey(): boolean {
  return hasProviderKey('gemini');
}
