import { describe, expect, it } from 'vitest';
import {
  createOverlayModelOp,
  modelDrawRect,
  resolveModelDrawAt,
  resolveModelPositionAt,
  resolveModelPoseAt,
  type AnimatedOverlayModelOp,
} from './overlayModel';

// ═══════════════════════════════════════════════════════════════════════════
// Keyframe-interpolation edge cases, complementing overlayModel.test.ts:
// interior keyframe boundaries, zero-span duplicates, purity of the sort,
// draw-rect clamping under keyframed motion, and window-independence.
// ═══════════════════════════════════════════════════════════════════════════

function animatedOp(keyframes: AnimatedOverlayModelOp['keyframes']) {
  return createOverlayModelOp({
    clipId: 'c1',
    inSec: 0,
    outSec: 10,
    modelUrl: 'blob:demo',
    position: { x: 0, y: 0 },
    scale: 1,
    rotationYDeg: 0,
    keyframes,
  }) as AnimatedOverlayModelOp;
}

describe('interior keyframe boundaries', () => {
  // Three keyframes: 0s → 2s → 8s. At t = 2 the left segment (k = 1) and the
  // right segment (k = 0) must agree exactly — the path is C0-continuous.
  const three = animatedOp([
    { tSec: 0, position: { x: -0.4, y: 0 }, scale: 1, rotationYDeg: 0 },
    { tSec: 2, position: { x: 0, y: 0.5 }, scale: 1.5, rotationYDeg: 45 },
    { tSec: 8, position: { x: 0.8, y: -0.5 }, scale: 2.5, rotationYDeg: 105 },
  ]);

  it('at an interior keyframe the pose equals that keyframe exactly', () => {
    expect(resolveModelPoseAt(three, 2)).toEqual({ rotationYDeg: 45, scale: 1.5 });
    expect(resolveModelPositionAt(three, 2)).toEqual({ x: 0, y: 0.5 });
  });

  it('the segment meeting at an interior keyframe is continuous from both sides', () => {
    const justLeft = resolveModelPoseAt(three, 1.999999);
    const justRight = resolveModelPoseAt(three, 2.000001);
    expect(justLeft.rotationYDeg).toBeCloseTo(justRight.rotationYDeg, 3);
    expect(justLeft.scale).toBeCloseTo(justRight.scale, 3);
    const posLeft = resolveModelPositionAt(three, 1.999999);
    const posRight = resolveModelPositionAt(three, 2.000001);
    expect(posLeft.x).toBeCloseTo(posRight.x, 3);
    expect(posLeft.y).toBeCloseTo(posRight.y, 3);
  });

  it('interpolates inside each segment with the segment-local fraction', () => {
    // Segment 2s → 8s at t = 5 → k = 0.5.
    expect(resolveModelPoseAt(three, 5)).toEqual({ rotationYDeg: 75, scale: 2 });
    expect(resolveModelPositionAt(three, 5)).toEqual({ x: 0.4, y: 0 });
  });

  it('outside the keyframe span, endpoints clamp regardless of the op window', () => {
    // resolveModel* are pure pose lookups: they never check [inSec, outSec] —
    // window enforcement belongs to applyOpsAtTime. Pin that contract.
    const op = animatedOp([
      { tSec: 3, position: { x: 0.1, y: 0.1 }, scale: 1, rotationYDeg: 0 },
      { tSec: 6, position: { x: 0.9, y: 0.9 }, scale: 3, rotationYDeg: 60 },
    ]);
    expect(resolveModelPoseAt(op, 0)).toEqual({ rotationYDeg: 0, scale: 1 });
    expect(resolveModelPoseAt(op, 9.5)).toEqual({ rotationYDeg: 60, scale: 3 });
    expect(resolveModelPositionAt(op, 100)).toEqual({ x: 0.9, y: 0.9 });
  });
});

describe('zero-span and duplicate keyframes', () => {
  it('two keyframes at the same tSec resolve to the earlier one at that instant', () => {
    const dup = animatedOp([
      { tSec: 1, position: { x: -0.5, y: 0 }, scale: 1, rotationYDeg: 0 },
      { tSec: 1, position: { x: 0.5, y: 0.4 }, scale: 2, rotationYDeg: 90 },
      { tSec: 4, position: { x: 0.5, y: 0.4 }, scale: 2, rotationYDeg: 90 },
    ]);
    expect(resolveModelPoseAt(dup, 1)).toEqual({ rotationYDeg: 0, scale: 1 });
    expect(resolveModelPositionAt(dup, 1)).toEqual({ x: -0.5, y: 0 });
    // Between the duplicates and the next keyframe the pose is constant.
    expect(resolveModelPoseAt(dup, 2.5)).toEqual({ rotationYDeg: 90, scale: 2 });
  });

  it('all keyframes at one timestamp behave like a single constant keyframe', () => {
    const flat = animatedOp([
      { tSec: 2, position: { x: 0.2, y: 0.2 }, scale: 1.2, rotationYDeg: 30 },
      { tSec: 2, position: { x: 0.3, y: 0.3 }, scale: 1.3, rotationYDeg: 40 },
    ]);
    for (const t of [0, 2]) {
      expect(resolveModelPoseAt(flat, t).scale).toBe(1.2);
    }
    // After the shared timestamp the last-span clamp takes over.
    expect(resolveModelPoseAt(flat, 5).scale).toBe(1.3);
  });
});

describe('purity', () => {
  it('sorting keyframes never mutates the op', () => {
    const keyframes = [
      { tSec: 6, position: { x: 0.6, y: 0 }, scale: 2, rotationYDeg: 90 },
      { tSec: 2, position: { x: -0.2, y: 0 }, scale: 1, rotationYDeg: 10 },
      { tSec: 4, position: { x: 0.2, y: 0.1 }, scale: 1.5, rotationYDeg: 50 },
    ];
    const op = animatedOp(keyframes);
    resolveModelPoseAt(op, 4);
    resolveModelPositionAt(op, 3);
    modelDrawRect(op, 5, 1000, 500);
    expect(op.keyframes).toEqual(keyframes);
    expect(op.keyframes?.map((k) => k.tSec)).toEqual([6, 2, 4]);
  });
});

describe('draw-rect clamping under keyframed motion', () => {
  const W = 1000;
  const H = 500;

  it('positions beyond [-1, 1] clamp to the frame edge', () => {
    const op = animatedOp([
      { tSec: 0, position: { x: 5, y: -7 }, scale: 1, rotationYDeg: 0 },
      { tSec: 5, position: { x: 5, y: -7 }, scale: 1, rotationYDeg: 0 },
    ]);
    const r = modelDrawRect(op, 2, W, H);
    // cx pinned to the right edge; y = -7 clamps to -1 → bottom edge (y is up).
    expect(r.dx + r.dw / 2).toBeCloseTo(W);
    expect(r.dy + r.dh / 2).toBeCloseTo(H);
  });

  it('scales outside [0.05, 10] clamp at the bounds', () => {
    const tiny = animatedOp([
      { tSec: 0, position: { x: 0, y: 0 }, scale: 0.001, rotationYDeg: 0 },
      { tSec: 5, position: { x: 0, y: 0 }, scale: 0.001, rotationYDeg: 0 },
    ]);
    const huge = animatedOp([
      { tSec: 0, position: { x: 0, y: 0 }, scale: 99, rotationYDeg: 0 },
      { tSec: 5, position: { x: 0, y: 0 }, scale: 99, rotationYDeg: 0 },
    ]);
    expect(modelDrawRect(tiny, 1, W, H).dw).toBeCloseTo(Math.min(W, H) * 0.62 * 0.05);
    expect(modelDrawRect(huge, 1, W, H).dw).toBeCloseTo(Math.min(W, H) * 0.62 * 10);
  });

  it('the rect follows the keyframed path at fractional t, and draw-at agrees', () => {
    const op = animatedOp([
      { tSec: 2, position: { x: -0.5, y: 0 }, scale: 1, rotationYDeg: 0 },
      { tSec: 4, position: { x: 0.5, y: 0 }, scale: 2, rotationYDeg: 90 },
    ]);
    // t = 3 → k = 0.5 → x = 0, scale = 1.5.
    const rect = modelDrawRect(op, 3, W, H);
    expect(rect.dx + rect.dw / 2).toBeCloseTo(W / 2);
    expect(rect.dw).toBeCloseTo(Math.min(W, H) * 0.62 * 1.5);

    const draw = resolveModelDrawAt(op, 3, W, H);
    expect(draw.rect).toEqual(rect);
    expect(draw.rotationYDeg).toBeCloseTo(45);
    expect(draw.scale).toBeCloseTo(1.5);
  });
});
