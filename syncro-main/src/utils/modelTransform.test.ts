import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_TRANSFORM,
  sanitizeTransform,
  setVec3At,
  type ModelTransform,
  type Vec3,
} from './modelTransform';

describe('sanitizeTransform', () => {
  it('returns defaults for null and undefined input', () => {
    expect(sanitizeTransform(null)).toEqual(DEFAULT_MODEL_TRANSFORM);
    expect(sanitizeTransform(undefined)).toEqual(DEFAULT_MODEL_TRANSFORM);
  });

  it('falls back to defaults for non-finite numbers', () => {
    const bad = {
      position: [NaN, Infinity, undefined as unknown as number] as unknown as Vec3,
      rotationDeg: [Number('nope'), 0, 0] as unknown as Vec3,
      scale: NaN,
    };
    expect(sanitizeTransform(bad)).toEqual(DEFAULT_MODEL_TRANSFORM);
  });

  it('preserves valid values', () => {
    const t: ModelTransform = { position: [1, -2, 3], rotationDeg: [90, 0, -45], scale: 1.5 };
    expect(sanitizeTransform(t)).toEqual(t);
  });

  it('clamps out-of-range values', () => {
    const t = sanitizeTransform({
      position: [99, -99, 0],
      rotationDeg: [1000, -1000, 0],
      scale: 500,
    });
    expect(t.position).toEqual([10, -10, 0]);
    expect(t.rotationDeg).toEqual([180, -180, 0]);
    expect(t.scale).toBe(10);
  });
});

describe('setVec3At', () => {
  it('replaces one axis without mutating the input', () => {
    const t: [number, number, number] = [1, 2, 3];
    expect(setVec3At(t, 1, 9)).toEqual([1, 9, 3]);
    expect(t).toEqual([1, 2, 3]);
  });
});
