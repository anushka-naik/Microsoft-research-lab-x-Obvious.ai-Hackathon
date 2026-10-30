import type { StyleBible } from '../state/editOps';
import { parseStyleBible } from './styleBible';
import { getProviderKey } from './apiKey';
import { startLog, finishLog } from './logger';

// ═══════════════════════════════════════════════════════════════════════════
// LLM provider selection + Groq fallback (OpenAI-compatible chat completions).
//
// Gemini stays the default the moment its key is configured; Groq is the free
// fallback (console.groq.com) used only while no GEMINI key exists. Selection
// happens at call time, so adding a Gemini key later needs no code change —
// the next generation just routes to Gemini again.
// ═══════════════════════════════════════════════════════════════════════════

export type LlmProvider = 'gemini' | 'groq';

export const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Pick the provider for this call: Gemini when its key is configured
 * (existing behavior, untouched), otherwise Groq when available, otherwise
 * null — callers keep their existing graceful no-key error path.
 */
export function selectLlmProvider(): LlmProvider | null {
  if (getProviderKey('gemini')) return 'gemini';
  if (getProviderKey('groq')) return 'groq';
  return null;
}

const STYLE_BIBLE_PROMPT = (description: string, referenceName?: string) =>
  `You are a colorist and video style director. Create a Style Bible: a single JSON spec every clip in the project must follow, so exports look consistent.

${referenceName
  ? `A reference clip (${referenceName}) was selected — derive the visual style (color temperature, contrast, mood, pacing) from its description below first, then honor the written request where it adds detail.`
  : 'No reference clip attached — work from the written description alone.'}

Style request: """${description || 'A clean, modern, slightly cinematic look.'}"""

Field semantics (respect these exactly):
- grade.brightness/contrast/saturation: multipliers, 1 = neutral (usable range 0-2).
- grade.temperature: -1 (cool/blue) to 1 (warm/orange), 0 = neutral.
- grade.vignette: 0 (none) to 1 (heavy), drawn as a radial darkening.
- captions: burned-in caption typography defaults.
- transitions.allowed: subset of cut, fade, dissolve, wipe; defaultDurationSec in seconds (0-5).
- pacing: avgCutLengthSec and minCutLengthSec in seconds (avgCut >= minCut).
- overlayTypography: font/weight/color for text overlays; shadow adds a drop shadow.

Respond with only the JSON object.`;

/**
 * The StyleBible schema in OpenAI json_schema (strict) form — mapped from the
 * Gemini responseSchema in services/gemini.ts so both providers constrain the
 * identical structure.
 */
export const STYLE_BIBLE_JSON_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'style_bible',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        grade: {
          type: 'object',
          properties: {
            brightness: { type: 'number' },
            contrast: { type: 'number' },
            saturation: { type: 'number' },
            temperature: { type: 'number' },
            vignette: { type: 'number' },
          },
          required: ['brightness', 'contrast', 'saturation', 'temperature', 'vignette'],
          additionalProperties: false,
        },
        captions: {
          type: 'object',
          properties: {
            font: { type: 'string' },
            fontSize: { type: 'number' },
            color: { type: 'string' },
            bg: { type: 'string' },
            position: { type: 'string', enum: ['bottom', 'top'] },
            mode: { type: 'string', enum: ['lower-third', 'word-highlight', 'speaker-labeled'] },
          },
          required: ['font', 'fontSize', 'color', 'bg', 'position', 'mode'],
          additionalProperties: false,
        },
        transitions: {
          type: 'object',
          properties: {
            allowed: { type: 'array', items: { type: 'string', enum: ['cut', 'fade', 'dissolve', 'wipe'] } },
            defaultDurationSec: { type: 'number' },
          },
          required: ['allowed', 'defaultDurationSec'],
          additionalProperties: false,
        },
        pacing: {
          type: 'object',
          properties: {
            avgCutLengthSec: { type: 'number' },
            minCutLengthSec: { type: 'number' },
          },
          required: ['avgCutLengthSec', 'minCutLengthSec'],
          additionalProperties: false,
        },
        overlayTypography: {
          type: 'object',
          properties: {
            font: { type: 'string' },
            weight: { type: 'number' },
            color: { type: 'string' },
            shadow: { type: 'boolean' },
          },
          required: ['font', 'weight', 'color', 'shadow'],
          additionalProperties: false,
        },
      },
      required: ['grade', 'captions', 'transitions', 'pacing', 'overlayTypography'],
      additionalProperties: false,
    },
  },
} as const;

async function postGroq(body: Record<string, unknown>): Promise<Response> {
  return fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getProviderKey('groq')}`,
    },
    body: JSON.stringify(body),
  });
}

interface GroqCompletion {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/**
 * Generate a StyleBible via Groq. Tries json_schema strict mode first; if the
 * endpoint rejects the strict schema it degrades to json_object and relies on
 * parseStyleBible for validation. Structurally invalid output throws so the
 * UI can offer a retry — same contract as the Gemini path.
 */
export async function generateStyleBibleViaGroq(description: string, referenceFile?: File): Promise<StyleBible> {
  const context = referenceFile ? ` | reference: ${referenceFile.name}` : '';
  const log = startLog('Generate Style Bible (Groq)', GROQ_MODEL, `"${description.slice(0, 80)}${description.length > 80 ? '…' : ''}"${context}`);
  try {
    const messages = [{ role: 'user', content: STYLE_BIBLE_PROMPT(description, referenceFile?.name) }];
    let response = await postGroq({
      model: GROQ_MODEL,
      messages,
      temperature: 0.4,
      response_format: STYLE_BIBLE_JSON_SCHEMA,
    });

    // Degrade to json_object when the endpoint rejects the strict schema.
    if (!response.ok) {
      const errBody = (await response.json().catch(() => null)) as GroqCompletion | null;
      const errMsg = errBody?.error?.message ?? '';
      const strictRejected = /strict|json_schema|response_format|schema/i.test(errMsg);
      if (!strictRejected) throw new Error(errMsg || `Groq request failed (${response.status})`);
      response = await postGroq({
        model: GROQ_MODEL,
        messages,
        temperature: 0.4,
        response_format: { type: 'json_object' },
      });
    }
    if (!response.ok) {
      const errBody = (await response.json().catch(() => null)) as GroqCompletion | null;
      throw new Error(errBody?.error?.message || `Groq request failed (${response.status})`);
    }

    const data = (await response.json()) as GroqCompletion;
    const bible = parseStyleBible(data.choices?.[0]?.message?.content ?? '');
    if (!bible) throw new Error('Model returned an invalid Style Bible — try again or adjust the description.');
    finishLog(log);
    return bible;
  } catch (err: any) {
    finishLog(log, err?.message ?? String(err));
    throw err;
  }
}
