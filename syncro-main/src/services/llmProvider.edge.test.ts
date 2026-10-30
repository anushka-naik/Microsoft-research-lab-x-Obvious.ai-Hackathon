import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateStyleBibleViaGroq, GROQ_MODEL, STYLE_BIBLE_JSON_SCHEMA } from './llmProvider';
import { setProviderKey } from './apiKey';

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases for the Groq provider mapping, complementing llmProvider.test.ts:
// strict json_schema integrity, json_object degradation chains, and clamping
// of out-of-range model output through the shared parseStyleBible gate.
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

const schemaRejections = [
  "'response_format' is not supported",
  "Parameter: response_format: json_schema is not allowed for this model",
  "Failed to deserialize the JSON body into the target schema",
  "strict mode is unavailable",
];

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

describe('STYLE_BIBLE_JSON_SCHEMA integrity', () => {
  it('is a strict json_schema wrapper named style_bible', () => {
    expect(STYLE_BIBLE_JSON_SCHEMA.type).toBe('json_schema');
    expect(STYLE_BIBLE_JSON_SCHEMA.json_schema.name).toBe('style_bible');
    expect(STYLE_BIBLE_JSON_SCHEMA.json_schema.strict).toBe(true);
  });

  it('requires all five top-level sections and forbids extra properties', () => {
    const schema = STYLE_BIBLE_JSON_SCHEMA.json_schema.schema;
    expect(schema.required).toEqual(['grade', 'captions', 'transitions', 'pacing', 'overlayTypography']);
    expect(schema.additionalProperties).toBe(false);
    for (const section of Object.values(schema.properties) as Array<Record<string, unknown>>) {
      expect(section.additionalProperties).toBe(false);
      expect((section.required as string[]).length).toBeGreaterThan(0);
    }
  });

  it('keeps the grade numeric fields and the enum vocabularies the Gemini path guarantees', () => {
    const schema = STYLE_BIBLE_JSON_SCHEMA.json_schema.schema as Record<string, any>;
    expect(schema.properties.grade.required).toEqual(['brightness', 'contrast', 'saturation', 'temperature', 'vignette']);
    expect(schema.properties.captions.properties.position.enum).toEqual(['bottom', 'top']);
    expect(schema.properties.captions.properties.mode.enum).toEqual(['lower-third', 'word-highlight', 'speaker-labeled']);
    expect(schema.properties.transitions.properties.allowed.items.enum).toEqual(['cut', 'fade', 'dissolve', 'wipe']);
  });
});

describe('strict json_schema request path', () => {
  it('sends the description and a reference-file name in the prompt', async () => {
    setProviderKey('groq', 'q-key');
    const fetchMock = vi.fn().mockResolvedValue(groqCompletion(JSON.stringify(validBible)));
    vi.stubGlobal('fetch', fetchMock);

    const reference = new File(['bytes'], 'reference.mp4');
    await generateStyleBibleViaGroq('warm cinematic look', reference);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.temperature).toBe(0.4);
    expect(body.messages[0].content).toContain('warm cinematic look');
    expect(body.messages[0].content).toContain('reference.mp4');
  });

  it('rejects a schema-violating response with an out-of-range grade instead of returning it unclamped-free', async () => {
    setProviderKey('groq', 'q-key');
    // brightness 9 is outside the documented 0–2 usable range: parseStyleBible
    // clamps, so the caller receives a bounded Bible or an error — never the
    // raw value.
    const outOfRange = {
      ...validBible,
      grade: { ...validBible.grade, brightness: 9, vignette: 4 },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqCompletion(JSON.stringify(outOfRange))));

    const bible = await generateStyleBibleViaGroq('look');
    expect(bible.grade.brightness).toBeLessThanOrEqual(2);
    expect(bible.grade.vignette).toBeLessThanOrEqual(1);
  });
});

describe('json_object degradation chain', () => {
  it.each(schemaRejections)('degrades on strict rejection: "%s"', async (message) => {
    setProviderKey('groq', 'q-key');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message } }) })
      .mockResolvedValueOnce(groqCompletion(JSON.stringify(validBible)));
    vi.stubGlobal('fetch', fetchMock);

    const bible = await generateStyleBibleViaGroq('look');
    expect(bible).toEqual(validBible);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(retryBody.response_format).toEqual({ type: 'json_object' });
  });

  it('throws the second error when the degraded json_object attempt also fails', async () => {
    setProviderKey('groq', 'q-key');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'strict json_schema not supported' } }),
      })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: 'json_object quota exceeded' } }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateStyleBibleViaGroq('look')).rejects.toThrow(/json_object quota exceeded/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed JSON content from the degraded path through the shared parse gate', async () => {
    setProviderKey('groq', 'q-key');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'response_format schema rejected' } }),
      })
      .mockResolvedValueOnce(groqCompletion('this is prose, not JSON'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateStyleBibleViaGroq('look')).rejects.toThrow(/invalid Style Bible/);
  });

  it('rejects empty and whitespace-only content without a retry', async () => {
    setProviderKey('groq', 'q-key');
    const fetchMock = vi.fn().mockResolvedValue(groqCompletion('   '));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateStyleBibleViaGroq('look')).rejects.toThrow(/invalid Style Bible/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the request under the key configured at call time', async () => {
    setProviderKey('groq', 'stale-key');
    const fetchMock = vi.fn().mockResolvedValue(groqCompletion(JSON.stringify(validBible)));
    vi.stubGlobal('fetch', fetchMock);

    await generateStyleBibleViaGroq('look');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer stale-key' });
  });
});
