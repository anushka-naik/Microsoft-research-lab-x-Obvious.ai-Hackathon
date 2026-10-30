import type { StyleBible } from '../state/editOps';

// ═══════════════════════════════════════════════════════════════════════════
// Style Bible — validation & serialization (pure, no DOM, no network).
//
// The Gemini schema guarantees structure but not numeric sanity: a model can
// return saturation 4.2 or a negative vignette. Everything crossing from the
// API into state goes through parseStyleBible so both render paths consume
// values inside their documented ranges.
// ═══════════════════════════════════════════════════════════════════════════

const CAPTION_MODES = ['lower-third', 'word-highlight', 'speaker-labeled'] as const;
const TRANSITION_TYPES = ['cut', 'fade', 'dissolve', 'wipe'] as const;
const POSITIONS = ['bottom', 'top'] as const;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function num(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function oneOf<T extends readonly string[]>(v: unknown, allowed: T): T[number] | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T[number]) : null;
}

function strArr<T extends readonly string[]>(v: unknown, allowed: T): T[number][] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((t): t is T[number] => typeof t === 'string' && (allowed as readonly string[]).includes(t));
}

/**
 * Validate an unknown value (typically a parsed Gemini response) into a
 * StyleBible. Numeric fields are clamped into range; enum fields must match
 * exactly; structurally invalid input returns null rather than throwing so a
 * bad generation can surface as a user-visible retry, not a crash.
 */
export function parseStyleBible(raw: unknown): StyleBible | null {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, Record<string, unknown> | unknown>;

  const grade = o.grade as Record<string, unknown> | undefined;
  if (typeof grade !== 'object' || grade === null) return null;
  const brightness = num(grade.brightness, 0, 2);
  const contrast = num(grade.contrast, 0, 2);
  const saturation = num(grade.saturation, 0, 2);
  const temperature = num(grade.temperature, -1, 1);
  const vignette = num(grade.vignette, 0, 1);
  if (brightness === null || contrast === null || saturation === null || temperature === null || vignette === null) return null;

  const captions = o.captions as Record<string, unknown> | undefined;
  if (typeof captions !== 'object' || captions === null) return null;
  const capFont = str(captions.font);
  const capFontSize = num(captions.fontSize, 8, 200);
  const capColor = str(captions.color);
  const capBg = str(captions.bg);
  const capPosition = oneOf(captions.position, POSITIONS);
  const capMode = oneOf(captions.mode, CAPTION_MODES);
  if (!capFont || capFontSize === null || !capColor || !capBg || !capPosition || !capMode) return null;

  const transitions = o.transitions as Record<string, unknown> | undefined;
  if (typeof transitions !== 'object' || transitions === null) return null;
  const allowed = strArr(transitions.allowed, TRANSITION_TYPES);
  const defaultDurationSec = num(transitions.defaultDurationSec, 0, 5);
  if (!allowed || defaultDurationSec === null) return null;

  const pacing = o.pacing as Record<string, unknown> | undefined;
  if (typeof pacing !== 'object' || pacing === null) return null;
  const avgCut = num(pacing.avgCutLengthSec, 0.5, 60);
  const minCut = num(pacing.minCutLengthSec, 0.1, 60);
  if (avgCut === null || minCut === null) return null;

  const overlay = o.overlayTypography as Record<string, unknown> | undefined;
  if (typeof overlay !== 'object' || overlay === null) return null;
  const ovFont = str(overlay.font);
  const ovWeight = num(overlay.weight, 100, 900);
  const ovColor = str(overlay.color);
  if (!ovFont || ovWeight === null || !ovColor || typeof overlay.shadow !== 'boolean') return null;

  return {
    grade: { brightness, contrast, saturation, temperature, vignette },
    captions: { font: capFont, fontSize: capFontSize, color: capColor, bg: capBg, position: capPosition, mode: capMode },
    transitions: { allowed, defaultDurationSec },
    pacing: { avgCutLengthSec: avgCut, minCutLengthSec: minCut },
    overlayTypography: { font: ovFont, weight: ovWeight, color: ovColor, shadow: overlay.shadow },
  };
}

/**
 * Stable JSON serialization — deterministic key order so two Bibles with the
 * same values produce the same string (tests, journal diffs, model context).
 */
export function serializeStyleBible(bible: StyleBible): string {
  return JSON.stringify(bible, null, 2);
}
