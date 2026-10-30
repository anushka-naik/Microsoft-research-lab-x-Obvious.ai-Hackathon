import type { EditOp, StyleBible } from './editOps';

// ═══════════════════════════════════════════════════════════════════════════
// Style-grade resolution — which grade applies at a given timeline instant.
//
// Precedence, matching the journal's last-write-wins replay convention:
//   1. The project-wide Bible (EditorState.styleBible) is the base grade.
//   2. Each applied style-grade op covering t overrides the base for its
//      range — or exempts it entirely (params.styleBible === null).
//   3. Stacked ranges: the LATEST journal op covering t wins.
//
// Pure: same ops, same t → same grade. The preview (CSS filter) and the
// export loop (ctx.filter + drawn vignette) both consume resolveGradeAtTime,
// so drift between the two paths is a bug class, not a design inevitability.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The effective grade at timeline instant `t`. Returns the Bible whose grade
 * applies (project default or range override), or null when the instant is
 * ungraded — either nothing is set or a range exemption silences the default.
 */
export function resolveGradeAtTime(ops: EditOp[], projectBible: StyleBible | null, t: number): StyleBible | null {
  let effective = projectBible;
  for (const op of ops) {
    if (op.status !== 'applied') continue;
    if (op.type !== 'style-grade') continue;
    if (t < op.inSec || t >= op.outSec) continue;
    // Journal order: each covering op overwrites the previous decision.
    effective = op.params.styleBible;
  }
  return effective;
}

/**
 * Map a Bible's grade to the CSS filter() syntax — the same string works for
 * a preview element's `style.filter` and the export canvas's `ctx.filter`,
 * which share the filter function grammar. Temperature maps to a warm sepia
 * shift (positive) or a cool hue rotation (negative); vignette is NOT a
 * filter — both render paths draw it separately (radial gradient on canvas,
 * box-shadow inset overlay in preview).
 */
export function gradeToCssFilter(bible: StyleBible | null): string {
  if (!bible) return '';
  const { brightness, contrast, saturation, temperature } = bible.grade;
  const parts = [
    `brightness(${brightness})`,
    `contrast(${contrast})`,
    `saturate(${saturation})`,
  ];
  if (temperature > 0) {
    parts.push(`sepia(${Math.min(1, temperature * 0.35)})`);
  } else if (temperature < 0) {
    parts.push(`hue-rotate(${(temperature * 15).toFixed(2)}deg)`);
  }
  return parts.join(' ');
}
