import { describe, it, expect } from 'vitest';
import { parseStyleBible, serializeStyleBible, styleBibleToPromptContext } from './styleBible';
import type { StyleBible } from '../state/editOps';

const validBible: StyleBible = {
  grade: { brightness: 1.1, contrast: 1.05, saturation: 0.9, temperature: 0.3, vignette: 0.25 },
  captions: { font: 'Inter', fontSize: 32, color: '#ffffff', bg: 'rgba(0,0,0,0.7)', position: 'bottom', mode: 'lower-third' },
  transitions: { allowed: ['fade', 'dissolve'], defaultDurationSec: 0.5 },
  pacing: { avgCutLengthSec: 4, minCutLengthSec: 1.5 },
  overlayTypography: { font: 'Inter', weight: 600, color: '#ffffff', shadow: true },
};

describe('parseStyleBible', () => {
  it('accepts a fully valid Bible unchanged', () => {
    expect(parseStyleBible(validBible)).toEqual(validBible);
  });

  it('accepts a JSON string form (raw model response)', () => {
    expect(parseStyleBible(JSON.stringify(validBible))).toEqual(validBible);
  });

  it('clamps out-of-range numbers into their documented ranges', () => {
    const result = parseStyleBible({
      ...validBible,
      grade: { brightness: 9, contrast: -2, saturation: 4, temperature: 3, vignette: -1 },
      captions: { ...validBible.captions, fontSize: 999 },
      pacing: { avgCutLengthSec: 400, minCutLengthSec: 0 },
    });
    expect(result?.grade).toEqual({ brightness: 2, contrast: 0, saturation: 2, temperature: 1, vignette: 0 });
    expect(result?.captions.fontSize).toBe(200);
    expect(result?.pacing.avgCutLengthSec).toBe(60);
    expect(result?.pacing.minCutLengthSec).toBe(0.1);
  });

  it('filters invalid transition types but keeps valid ones', () => {
    const result = parseStyleBible({
      ...validBible,
      transitions: { allowed: ['fade', 'crossfade', 'wipe', 42], defaultDurationSec: 0.5 },
    });
    expect(result?.transitions.allowed).toEqual(['fade', 'wipe']);
  });

  it('returns null when a required section is missing', () => {
    const { grade, ...withoutGrade } = validBible;
    void grade;
    expect(parseStyleBible(withoutGrade)).toBeNull();
    expect(parseStyleBible({ ...validBible, pacing: undefined })).toBeNull();
  });

  it('returns null when a required field is the wrong type', () => {
    expect(parseStyleBible({ ...validBible, grade: { ...validBible.grade, brightness: 'bright' } })).toBeNull();
    expect(parseStyleBible({ ...validBible, overlayTypography: { ...validBible.overlayTypography, shadow: 'yes' } })).toBeNull();
    expect(parseStyleBible({ ...validBible, captions: { ...validBible.captions, mode: 'karaoke' } })).toBeNull();
  });

  it('returns null for non-object garbage', () => {
    expect(parseStyleBible(null)).toBeNull();
    expect(parseStyleBible(42)).toBeNull();
    expect(parseStyleBible('not json {')).toBeNull();
    expect(parseStyleBible('[]')).toBeNull();
  });

  it('round-trips through serialization', () => {
    expect(parseStyleBible(serializeStyleBible(validBible))).toEqual(validBible);
  });
});

describe('serializeStyleBible', () => {
  it('is deterministic — same values, same string', () => {
    expect(serializeStyleBible(validBible)).toBe(serializeStyleBible(validBible));
  });

  it('produces valid JSON that parses back to the input', () => {
    expect(JSON.parse(serializeStyleBible(validBible))).toEqual(validBible);
  });
});

describe('styleBibleToPromptContext', () => {
  it('carries every dimension into the prompt block', () => {
    const ctx = styleBibleToPromptContext(validBible);
    expect(ctx).toContain('brightness 1.1');
    expect(ctx).toContain('temperature 0.3');
    expect(ctx).toContain('fade, dissolve');
    expect(ctx).toContain('avgCutLengthSec'.replace('avgCutLengthSec', 'average cut 4'));
    expect(ctx).toContain('weight 600');
    expect(ctx).toContain('with drop shadow');
  });

  it('omits the shadow mention for shadowless typography', () => {
    const flat = { ...validBible, overlayTypography: { ...validBible.overlayTypography, shadow: false } };
    expect(styleBibleToPromptContext(flat)).not.toContain('shadow');
  });
});
