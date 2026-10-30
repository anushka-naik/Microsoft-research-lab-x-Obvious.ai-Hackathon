import { describe, it, expect } from 'vitest';
import { resolveGradeAtTime, gradeToCssFilter } from './styleGrade';
import { createTextOverlayOp, createTrimOp } from './editOps';
import type { EditOp, StyleBible } from './editOps';

function gradeOp(id: string, inSec: number, outSec: number, bible: StyleBible | null, status: EditOp['status'] = 'applied'): EditOp {
  return {
    id: `op-${id}`,
    clipId: 'clip-1',
    inSec,
    outSec,
    status,
    type: 'style-grade',
    params: { styleBible: bible },
  };
}

const warm: StyleBible = {
  grade: { brightness: 1.1, contrast: 1.2, saturation: 1.3, temperature: 0.5, vignette: 0.2 },
  captions: { font: 'Inter', fontSize: 32, color: '#fff', bg: '#000', position: 'bottom', mode: 'lower-third' },
  transitions: { allowed: ['fade'], defaultDurationSec: 0.5 },
  pacing: { avgCutLengthSec: 4, minCutLengthSec: 1 },
  overlayTypography: { font: 'Inter', weight: 600, color: '#fff', shadow: true },
};

const cool: StyleBible = { ...warm, grade: { ...warm.grade, temperature: -0.6, vignette: 0 } };

describe('resolveGradeAtTime', () => {
  it('returns the project-wide Bible when no ops cover t', () => {
    const ops = [gradeOp('a', 5, 8, warm)];
    expect(resolveGradeAtTime(ops, warm, 2)).toBe(warm);
  });

  it('returns null when nothing is set', () => {
    expect(resolveGradeAtTime([], null, 1)).toBeNull();
  });

  it('a range op overrides the project default inside [inSec, outSec)', () => {
    const ops = [gradeOp('a', 5, 8, cool)];
    expect(resolveGradeAtTime(ops, warm, 6)).toBe(cool);
    expect(resolveGradeAtTime(ops, warm, 4.9)).toBe(warm);
    // Half-open interval: outSec itself is already past the range.
    expect(resolveGradeAtTime(ops, warm, 8)).toBe(warm);
  });

  it('a null-Bible range op exempts t from the project default', () => {
    const ops = [gradeOp('a', 5, 8, null)];
    expect(resolveGradeAtTime(ops, warm, 6)).toBeNull();
  });

  it('stacked ranges: the latest journal op covering t wins', () => {
    const ops = [gradeOp('first', 2, 10, cool), gradeOp('second', 4, 6, warm)];
    // Both cover t=5 — second (later in journal) wins.
    expect(resolveGradeAtTime(ops, null, 5)).toBe(warm);
    // Only the first covers t=8.
    expect(resolveGradeAtTime(ops, null, 8)).toBe(cool);
    // Latest-first exemption beats an earlier override.
    expect(resolveGradeAtTime([gradeOp('x', 2, 10, warm), gradeOp('y', 4, 6, null)], warm, 5)).toBeNull();
  });

  it('ignores non-style-grade and non-applied ops', () => {
    const clip = { id: 'clip-1', file: {} as File, url: 'blob:x', duration: 10, startTime: 0, name: 'x' };
    const noise = [
      createTrimOp('clip-1', 0, 10, { trimStart: 0 }),
      createTextOverlayOp('clip-1', 0, 10, { text: 'hi' }),
      gradeOp('draft', 0, 10, warm, 'draft'),
      gradeOp('failed', 0, 10, warm, 'failed'),
    ] as EditOp[];
    expect(resolveGradeAtTime([...noise, gradeOp('ok', 0, 10, cool)], null, 5)).toBe(cool);
    expect(resolveGradeAtTime(noise, null, 5)).toBeNull();
    void clip;
  });
});

describe('gradeToCssFilter', () => {
  it('returns an empty string when ungraded', () => {
    expect(gradeToCssFilter(null)).toBe('');
  });

  it('emits the shared filter() grammar from the grade fields', () => {
    const css = gradeToCssFilter(warm);
    expect(css).toContain('brightness(1.1)');
    expect(css).toContain('contrast(1.2)');
    expect(css).toContain('saturate(1.3)');
  });

  it('maps warm temperature to sepia and cool to hue-rotate', () => {
    expect(gradeToCssFilter(warm)).toContain('sepia(');
    expect(gradeToCssFilter(cool)).toContain('hue-rotate(');
  });

  it('omits temperature functions for a neutral grade', () => {
    const neutral: StyleBible = { ...warm, grade: { ...warm.grade, temperature: 0 } };
    const css = gradeToCssFilter(neutral);
    expect(css).not.toContain('sepia');
    expect(css).not.toContain('hue-rotate');
  });

  it('produces a string valid as ctx.filter (CSS filter grammar)', () => {
    // ctx.filter accepts the CSS filter syntax — same string both paths use.
    expect(gradeToCssFilter(warm)).toMatch(/^brightness\([\d.]+\) contrast\([\d.]+\) saturate\([\d.]+\) (sepia\([\d.]+\)|hue-rotate\(-?[\d.]+deg\))$/);
  });
});
