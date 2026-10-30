import { describe, expect, it } from 'vitest';
import { evaluateKeyGate, PROVIDER_SPECS, type ProviderKeyStatus } from './providerGate';

const NO_KEYS: ProviderKeyStatus = { gemini: false, groq: false, fal: false, meshy: false, tripo: false };

describe('evaluateKeyGate', () => {
  it('blocks style-bible without keys and offers Gemini then Groq', () => {
    const gate = evaluateKeyGate('style-bible', NO_KEYS);
    expect(gate.ok).toBe(false);
    expect(gate.offers.map(o => o.id)).toEqual(['gemini', 'groq']);
  });

  it('unlocks style-bible with only the Groq fallback', () => {
    const gate = evaluateKeyGate('style-bible', { ...NO_KEYS, groq: true });
    expect(gate.ok).toBe(true);
    expect(gate.offers).toEqual([]);
  });

  it('unlocks style-bible with only Gemini', () => {
    expect(evaluateKeyGate('style-bible', { ...NO_KEYS, gemini: true }).ok).toBe(true);
  });

  it('voiceover TTS requires Gemini specifically', () => {
    expect(evaluateKeyGate('voiceover-tts', { ...NO_KEYS, groq: true }).ok).toBe(false);
    expect(evaluateKeyGate('voiceover-tts', { ...NO_KEYS, gemini: true }).ok).toBe(true);
    expect(evaluateKeyGate('voiceover-tts', NO_KEYS).offers.map(o => o.id)).toEqual(['gemini']);
  });

  it('object surgery accepts fal or Gemini, offering fal first', () => {
    expect(evaluateKeyGate('object-surgery', NO_KEYS).offers.map(o => o.id)).toEqual(['fal', 'gemini']);
    expect(evaluateKeyGate('object-surgery', { ...NO_KEYS, gemini: true }).ok).toBe(true);
    expect(evaluateKeyGate('object-surgery', { ...NO_KEYS, fal: true }).ok).toBe(true);
  });

  it('image-to-3d accepts Meshy or Tripo, offering Meshy first', () => {
    expect(evaluateKeyGate('image-to-3d', NO_KEYS).offers.map(o => o.id)).toEqual(['meshy', 'tripo']);
    expect(evaluateKeyGate('image-to-3d', { ...NO_KEYS, tripo: true }).ok).toBe(true);
  });

  it('every offer carries a key URL, label, and placeholder', () => {
    for (const spec of Object.values(PROVIDER_SPECS)) {
      expect(spec.keyUrl).toMatch(/^https:\/\//);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.placeholder.length).toBeGreaterThan(0);
      expect(spec.what.length).toBeGreaterThan(0);
    }
  });
});
