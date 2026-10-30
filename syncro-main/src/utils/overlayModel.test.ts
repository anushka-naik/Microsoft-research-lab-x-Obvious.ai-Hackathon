import { describe, expect, it } from 'vitest';
import {
  createOverlayModelOp,
  modelDrawRect,
  resolveModelDrawAt,
  resolveModelPositionAt,
  resolveModelPoseAt,
} from './overlayModel';

const op = createOverlayModelOp({
  clipId: 'c1',
  inSec: 2,
  outSec: 6,
  modelUrl: 'blob:demo',
  position: { x: 0.25, y: -0.5 },
  scale: 1.5,
  rotationYDeg: 40,
});

describe('static ops (no keyframes)', () => {
  it('uses params for pose and position', () => {
    expect(resolveModelPoseAt(op, 3)).toEqual({ rotationYDeg: 40, scale: 1.5 });
    expect(resolveModelPositionAt(op, 5)).toEqual({ x: 0.25, y: -0.5 });
  });

  it('draws centered, offset by position, sized by scale', () => {
    const W = 1000;
    const H = 500;
    const r = modelDrawRect(op, 3, W, H);
    expect(r.dw).toBeCloseTo(500 * 0.62 * 1.5);
    expect(r.dx).toBeCloseTo(W / 2 + 0.25 * (W / 2) - r.dw / 2);
    expect(r.dy).toBeCloseTo(H / 2 - (-0.5) * (H / 2) - r.dh / 2);
  });

  it('emits a complete draw instruction set at time t', () => {
    const d = resolveModelDrawAt(op, 4, 800, 600);
    expect(d.rotationYDeg).toBe(40);
    expect(d.scale).toBe(1.5);
    expect(d.rect.dh).toBeCloseTo(600 * 0.62 * 1.5);
  });
});

describe('keyframed ops', () => {
  const animated = createOverlayModelOp({
    clipId: 'c1',
    inSec: 2,
    outSec: 6,
    modelUrl: 'blob:demo',
    position: { x: 0, y: 0 },
    scale: 1,
    rotationYDeg: 0,
    keyframes: [
      { tSec: 6, position: { x: 0.6, y: 0.2 }, scale: 2, rotationYDeg: 90 },
      { tSec: 2, position: { x: -0.2, y: 0 }, scale: 1, rotationYDeg: 10 },
    ],
  });

  it('clamps to the first keyframe before the span', () => {
    expect(resolveModelPoseAt(animated, 0)).toEqual({ rotationYDeg: 10, scale: 1 });
    expect(resolveModelPositionAt(animated, 1)).toEqual({ x: -0.2, y: 0 });
  });

  it('clamps to the last keyframe after the span', () => {
    expect(resolveModelPoseAt(animated, 99)).toEqual({ rotationYDeg: 90, scale: 2 });
  });

  it('hits keyframes exactly at their timestamps', () => {
    expect(resolveModelPositionAt(animated, 2)).toEqual({ x: -0.2, y: 0 });
    expect(resolveModelPositionAt(animated, 6)).toEqual({ x: 0.6, y: 0.2 });
  });

  it('linearly interpolates between keyframes at time t', () => {
    // Midpoint of 2s→6s.
    expect(resolveModelPositionAt(animated, 4)).toEqual({ x: 0.2, y: 0.1 });
    expect(resolveModelPoseAt(animated, 4)).toEqual({ rotationYDeg: 50, scale: 1.5 });
    // Quarter point (k = 0.25).
    expect(resolveModelPositionAt(animated, 3).x).toBeCloseTo(-0.2 + 0.8 * 0.25);
    expect(resolveModelPoseAt(animated, 3).rotationYDeg).toBeCloseTo(10 + 80 * 0.25);
  });

  it('treats a single keyframe as constant', () => {
    const one = createOverlayModelOp({
      clipId: 'c1', inSec: 0, outSec: 5, modelUrl: 'u',
      position: { x: 0, y: 0 }, scale: 1, rotationYDeg: 0,
      keyframes: [{ tSec: 1, position: { x: 0.3, y: 0.4 }, scale: 2, rotationYDeg: 15 }],
    });
    expect(resolveModelPositionAt(one, 0)).toEqual({ x: 0.3, y: 0.4 });
    expect(resolveModelPoseAt(one, 4.9)).toEqual({ rotationYDeg: 15, scale: 2 });
  });
});
