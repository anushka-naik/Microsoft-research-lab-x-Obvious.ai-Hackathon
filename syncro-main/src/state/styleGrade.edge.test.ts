import { describe, expect, it } from 'vitest';
import { resolveGradeAtTime, gradeToCssFilter } from './styleGrade';
import type { EditOp, StyleBible } from './editOps';

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases for style-grade resolution, complementing styleGrade.test.ts:
// stacked ranges at exact boundaries, zero-width and exemption boundaries,
// and Bibles carrying empty/whitespace or extreme values.
// ═══════════════════════════════════════════════════════════════════════════

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

describe('default grading', () => {
  it('returns the project default whenever no APPLIED grade op covers t', () => {
    const ops: EditOp[] = [
      gradeOp('draft', 0, 10, cool, 'draft'),
      gradeOp('failed', 0, 10, cool, 'failed'),
      gradeOp('later', 10, 20, cool),
    ];
    expect(resolveGradeAtTime(ops, warm, 5)).toBe(warm);
  });

  it('returns null when only a project default is absent and nothing covers t', () => {
    const ops = [gradeOp('later', 10, 20, warm)];
    expect(resolveGradeAtTime(ops, null, 5)).toBeNull();
  });

  it('negative timestamps grade like any other instant', () => {
    const ops = [gradeOp('neg', -5, 0, cool)];
    expect(resolveGradeAtTime(ops, warm, -4.5)).toBe(cool);
    expect(resolveGradeAtTime(ops, warm, 0)).toBe(warm);
  });
});

describe('stacked ranges at boundaries', () => {
  const stacked = [gradeOp('outer', 2, 10, cool), gradeOp('inner', 4, 6, warm)];

  it('at the inner range start (t = inSec) the inner op already wins', () => {
    expect(resolveGradeAtTime(stacked, null, 4)).toBe(warm);
    expect(resolveGradeAtTime(stacked, null, 3.999)).toBe(cool);
  });

  it('at the inner range end (t = outSec) the half-open window hands back to the outer op', () => {
    expect(resolveGradeAtTime(stacked, null, 6)).toBe(cool);
    expect(resolveGradeAtTime(stacked, null, 5.999)).toBe(warm);
  });

  it('fractional boundaries stay exact in journal order', () => {
    const fractional = [gradeOp('a', 1.5, 5.25, cool), gradeOp('b', 3.75, 7.5, warm)];
    expect(resolveGradeAtTime(fractional, null, 3.749)).toBe(cool);
    expect(resolveGradeAtTime(fractional, null, 3.75)).toBe(warm);
    // At the outer range's outSec the outer op is done; only the inner covers.
    expect(resolveGradeAtTime(fractional, null, 5.25)).toBe(warm);
    expect(resolveGradeAtTime(fractional, null, 5.249)).toBe(warm);
    // Past the inner range's outSec nothing covers — back to the default.
    expect(resolveGradeAtTime(fractional, null, 7.5)).toBeNull();
  });

  it('a zero-width range [t, t) never applies', () => {
    const ops = [gradeOp('empty', 5, 5, warm)];
    expect(resolveGradeAtTime(ops, null, 5)).toBeNull();
    expect(resolveGradeAtTime(ops, warm, 5)).toBe(warm);
  });

  it('an exemption over an override hands back to the default at the exact boundary', () => {
    const ops = [gradeOp('grade', 2, 10, warm), gradeOp('exempt', 4, 6, null)];
    expect(resolveGradeAtTime(ops, cool, 3.999)).toBe(warm);
    expect(resolveGradeAtTime(ops, cool, 4)).toBeNull();
    expect(resolveGradeAtTime(ops, cool, 6)).toBe(warm);
  });
});

describe('empty and whitespace Bible values', () => {
  // resolveGradeAtTime is a selector, not a validator: the Bible passes
  // through untouched and render paths own the display of degenerate values.
  it('passes a Bible with empty/whitespace string fields through unchanged', () => {
    const blank: StyleBible = {
      ...warm,
      captions: { ...warm.captions, font: '', color: '   ' },
      overlayTypography: { ...warm.overlayTypography, font: '' },
    };
    const ops = [gradeOp('blank', 0, 10, blank)];
    expect(resolveGradeAtTime(ops, warm, 5)).toBe(blank);
    // The same degenerate Bible also resolves as a project-wide default.
    expect(resolveGradeAtTime([], blank, 5)).toBe(blank);
  });

  it('the grade filter is emitted even when typography fields are blank', () => {
    const blank: StyleBible = { ...warm, captions: { ...warm.captions, font: '' } };
    const css = gradeToCssFilter(blank);
    expect(css).toContain('brightness(1.1)');
    expect(css).toContain('contrast(1.2)');
  });

  it('zero grade values still render a valid filter string', () => {
    const flat: StyleBible = { ...warm, grade: { brightness: 0, contrast: 0, saturation: 0, temperature: 0, vignette: 0 } };
    expect(gradeToCssFilter(flat)).toBe('brightness(0) contrast(0) saturate(0)');
  });

  it('clamps an extreme warm temperature at sepia(1)', () => {
    const extreme: StyleBible = { ...warm, grade: { ...warm.grade, temperature: 5 } };
    expect(gradeToCssFilter(extreme)).toContain('sepia(1)');
  });

  it('formats a fully cool temperature as hue-rotate(-15.00deg)', () => {
    const icy: StyleBible = { ...warm, grade: { ...warm.grade, temperature: -1 } };
    expect(gradeToCssFilter(icy)).toContain('hue-rotate(-15.00deg)');
  });
});
