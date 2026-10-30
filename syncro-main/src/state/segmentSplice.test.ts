import { describe, expect, it } from 'vitest';
import { EditOp, createObjectInsertOp, createObjectRemoveOp } from './editOps';
import { SegmentSplice, resolveSegmentSplice } from './segmentSplice';

const RESULT_URL = 'blob:segment-webm';

function appliedRemove(): EditOp {
  const op = createObjectRemoveOp('clip-1', 3, 7, { point: { x: 100, y: 80 } });
  return { ...op, status: 'applied', resultUrl: RESULT_URL };
}

describe('resolveSegmentSplice', () => {
  it('resolves the segment inside [inSec, outSec) with the segment-relative time', () => {
    const splice = resolveSegmentSplice([appliedRemove()], 'clip-1', 5);
    expect(splice).not.toBeNull();
    expect(splice!.opType).toBe('object-remove');
    expect(splice!.segmentTime).toBeCloseTo(2); // 5s − inSec 3s
    expect(splice!.resultUrl).toBe(RESULT_URL);
  });

  it('keeps the source outside the window (no splice before or after)', () => {
    const ops = [appliedRemove()];
    expect(resolveSegmentSplice(ops, 'clip-1', 2.9)).toBeNull();
    expect(resolveSegmentSplice(ops, 'clip-1', 7.01)).toBeNull();
    expect(resolveSegmentSplice(ops, 'clip-1', 30)).toBeNull();
  });

  it('honors boundary continuity: inSec inclusive, outSec exclusive', () => {
    const ops = [appliedRemove()];
    expect(resolveSegmentSplice(ops, 'clip-1', 3)).not.toBeNull();  // first segment frame
    const lastInside = resolveSegmentSplice(ops, 'clip-1', 6.999);
    expect(lastInside).not.toBeNull();
    expect(resolveSegmentSplice(ops, 'clip-1', 7)).toBeNull();      // first source frame again
  });

  it('ignores draft ops and applied ops without a resultUrl (source plays through)', () => {
    const draft = createObjectRemoveOp('clip-1', 3, 7, { point: { x: 1, y: 2 } });
    expect(resolveSegmentSplice([draft], 'clip-1', 5)).toBeNull();
    const pending = { ...draft, status: 'applied' as const };
    expect(resolveSegmentSplice([pending], 'clip-1', 5)).toBeNull();
  });

  it('ignores ops on other clips', () => {
    const other = { ...appliedRemove(), clipId: 'clip-2' };
    expect(resolveSegmentSplice([other], 'clip-1', 5)).toBeNull();
    expect(resolveSegmentSplice([other], null, 5)).not.toBeNull(); // null disables the scoping check
  });

  it('lets the latest journal op win on overlapping windows', () => {
    const first = appliedRemove();
    const second = { ...createObjectInsertOp('clip-1', 5, 9, { description: 'vase' }), status: 'applied' as const, resultUrl: 'blob:second' };
    const at4 = resolveSegmentSplice([first, second], 'clip-1', 4);
    expect(at4!.opId).toBe(first.id);
    const at6 = resolveSegmentSplice([first, second], 'clip-1', 6);
    expect(at6!.opId).toBe(second.id);
    expect(at6!.opType).toBe('object-insert');
  });

  it('ignores structural ops entirely', () => {
    const trim = { id: 't1', clipId: 'clip-1', inSec: 3, outSec: 7, status: 'applied' as const, type: 'trim' as const, params: { trimStart: 1 } };
    expect(resolveSegmentSplice([trim as unknown as EditOp], 'clip-1', 5)).toBeNull();
  });

  it('is deterministic: same inputs produce identical splices', () => {
    const ops = [appliedRemove()];
    const a: SegmentSplice | null = resolveSegmentSplice(ops, 'clip-1', 5.5);
    const b: SegmentSplice | null = resolveSegmentSplice(ops, 'clip-1', 5.5);
    expect(b).toEqual(a);
  });
});
