// Per-provider API keys stored in localStorage, mirroring services/apiKey.ts
// (browser-only storage, keys never leave the user's machine except to the
// provider itself). The key-entry UI in App.tsx reads/writes through here.

const MESHY_STORAGE_KEY = 'syncro_meshy_api_key';
const TRIPO_STORAGE_KEY = 'syncro_tripo_api_key';

function setStoredKey(storageKey: string, value: string): void {
  if (value.trim()) {
    localStorage.setItem(storageKey, value.trim());
  } else {
    localStorage.removeItem(storageKey);
  }
}

export function getMeshyApiKey(): string {
  return localStorage.getItem(MESHY_STORAGE_KEY) ?? '';
}

export function setMeshyApiKey(key: string): void {
  setStoredKey(MESHY_STORAGE_KEY, key);
}

export function hasMeshyApiKey(): boolean {
  return !!localStorage.getItem(MESHY_STORAGE_KEY);
}

export function getTripoApiKey(): string {
  return localStorage.getItem(TRIPO_STORAGE_KEY) ?? '';
}

export function setTripoApiKey(key: string): void {
  setStoredKey(TRIPO_STORAGE_KEY, key);
}

export function hasTripoApiKey(): boolean {
  return !!localStorage.getItem(TRIPO_STORAGE_KEY);
}
