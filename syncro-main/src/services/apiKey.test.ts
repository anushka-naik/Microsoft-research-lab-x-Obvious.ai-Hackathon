import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getApiKey,
  getProviderKey,
  hasApiKey,
  hasProviderKey,
  setApiKey,
  setProviderKey,
} from './apiKey';

// Minimal localStorage stub — vitest runs in a plain node environment.
const store = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

beforeEach(() => {
  vi.stubGlobal('localStorage', localStorageStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  store.clear();
});

describe('provider key store', () => {
  it('round-trips keys per provider in independent namespaces', () => {
    setProviderKey('fal', 'fal-key-123');
    setProviderKey('gemini', 'gem-key-456');
    expect(getProviderKey('fal')).toBe('fal-key-123');
    expect(getProviderKey('gemini')).toBe('gem-key-456');
    expect(getProviderKey('replicate')).toBe('');
  });

  it('trims on save and clears on empty', () => {
    setProviderKey('replicate', '  r8_token  ');
    expect(getProviderKey('replicate')).toBe('r8_token');
    setProviderKey('replicate', '   ');
    expect(hasProviderKey('replicate')).toBe(false);
  });

  it('keeps the legacy Gemini aliases pointed at the gemini slot', () => {
    setApiKey('legacy-key');
    expect(getApiKey()).toBe('legacy-key');
    expect(hasApiKey()).toBe(true);
    expect(getProviderKey('gemini')).toBe('legacy-key');
  });

  it('does not collide with the legacy gemini storage key name', () => {
    // The gemini slot must keep its historical storage key so saved keys survive.
    setProviderKey('gemini', 'k');
    expect(store.has('syncro_gemini_api_key')).toBe(true);
  });
});
