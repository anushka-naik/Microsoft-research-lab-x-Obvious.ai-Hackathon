import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLlmProvider, generateStyleBibleViaGroq, GROQ_MODEL, STYLE_BIBLE_JSON_SCHEMA } from './llmProvider';
import { setProviderKey } from './apiKey';

// ═══════════════════════════════════════════════════════════════════════════
// Provider selection (call-time) + Groq client contract.
//
// The routing rule under test: Gemini wins whenever its key exists (existing
// behavior untouched), Groq serves only without one, and no key at all keeps
// the callers' existing graceful error path. Groq responses are validated
// through the same parseStyleBible gate as Gemini output.
// ═══════════════════════════════════════════════════════════════════════════

const validBible = {
  grade: { brightness: 1.1, contrast: 1.05, saturation: 0.9, temperature: 0.3, vignette: 0.25 },
  captions: { font: 'Inter', fontSize: 32, color: '#ffffff', bg: 'rgba(0,0,0,0.7)', position: 'bottom', mode: 'lower-third' },
  transitions: { allowed: ['fade', 'dissolve'], defaultDurationSec: 0.5 },
  pacing: { avgCutLengthSec: 4, minCutLengthSec: 1.5 },
  overlayTypography: { font: 'Inter', weight: 600, color: '#ffffff', shadow: true },
};

function groqCompletion(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as Response;
}

// Node test env has no localStorage — stub an in-memory implementation so the
// provider-key helpers run as written.
const store = new Map<string, string>();

function stubStorage() {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  });
}

beforeEach(() => {
  stubStorage();
  store.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  store.clear();
});

describe('selectLlmProvider', () => {
  it('routes to gemini when a Gemini key is configured — even with a Groq key present', () => {
    setProviderKey('gemini', 'g-key');
    setProviderKey('groq', 'q-key');
    expect(selectLlmProvider()).toBe('gemini');
  });

  it('falls back to groq only when no Gemini key exists', () => {
    setProviderKey('groq', 'q-key');
    expect(selectLlmProvider()).toBe('groq');
  });

  it('returns null with no key at all so callers keep their existing error path', () => {
    expect(selectLlmProvider()).toBeNull();
  });
});

describe('generateStyleBibleViaGroq', () => {
  it('parses a mocked Groq response through the shared StyleBible validation', async () => {
    setProviderKey('groq', 'q-key');
    const fetchMock = vi.fn().mockResolvedValue(groqCompletion(JSON.stringify(validBible)));
    vi.stubGlobal('fetch', fetchMock);

    const bible = await generateStyleBibleViaGroq('warm cinematic look');

    expect(bible).toEqual(validBible);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe(GROQ_MODEL);
    // Strict json_schema first attempt, mapped from the Gemini responseSchema.
    expect(body.response_format).toEqual(STYLE_BIBLE_JSON_SCHEMA);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer q-key' });
  });

  it('rejects a structurally invalid response instead of returning a bad Bible', async () => {
    setProviderKey('groq', 'q-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqCompletion('{"grade": {"brightness": 1}}')));

    await expect(generateStyleBibleViaGroq('look')).rejects.toThrow(/invalid Style Bible/);
  });

  it('degrades to json_object when the endpoint rejects the strict schema, then still validates', async () => {
    setProviderKey('groq', 'q-key');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "'response_format' does not support strict json_schema for this model" } }),
      })
      .mockResolvedValueOnce(groqCompletion(JSON.stringify(validBible)));
    vi.stubGlobal('fetch', fetchMock);

    const bible = await generateStyleBibleViaGroq('warm cinematic look');

    expect(bible).toEqual(validBible);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(secondBody.response_format).toEqual({ type: 'json_object' });
  });

  it('surfaces a non-schema provider error instead of retrying', async () => {
    setProviderKey('groq', 'q-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API key' } }),
    }));

    await expect(generateStyleBibleViaGroq('look')).rejects.toThrow(/Invalid API key/);
  });
});
