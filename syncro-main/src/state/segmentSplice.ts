// Segment splice resolution — the pure core of "segment inside [inSec, outSec),
// source outside".
//
// Pre-rendered generative segments (object-remove / object-insert) live on the
// op's resultUrl. At any timeline instant t, at most one such segment is
// active: the latest journal op whose window covers t. Outside every window —
// and while a generation is still draft, failed, or missing its resultUrl —
// this returns null and renderers draw the untouched source. That half-open
// window [inSec, outSec) is what keeps splices clean at the boundaries: the
// frame at inSec is the first segment frame, the frame at outSec is the first
// source frame, so footage immediately before and after the range stays
// byte-comparable to the source.

import { EditOp } from './editOps';

export type SegmentOpType = 'object-remove' | 'object-insert';

export interface SegmentSplice {
  opId: string;
  opType: SegmentOpType;
  /** Seconds into the pre-rendered segment this timeline instant maps to. */
  segmentTime: number;
  resultUrl: string;
}

/**
 * Resolve the active pre-rendered segment at timeline instant `t`.
 * `clipId` scopes the lookup to the active clip (pass null to skip that check).
 * Pure and deterministic: same inputs, same splice.
 */
export function resolveSegmentSplice(ops: EditOp[], clipId: string | null, t: number): SegmentSplice | null {
  let best: SegmentSplice | null = null;
  for (const op of ops) {
    if (op.status !== 'applied') continue;
    if (op.type !== 'object-remove' && op.type !== 'object-insert') continue;
    if (clipId !== null && op.clipId !== clipId) continue;
    if (!op.resultUrl) continue;
    if (t < op.inSec || t >= op.outSec) continue;
    // Journal order wins: a later op covering the same instant supersedes earlier ones.
    best = { opId: op.id, opType: op.type, segmentTime: t - op.inSec, resultUrl: op.resultUrl };
  }
  return best;
}
