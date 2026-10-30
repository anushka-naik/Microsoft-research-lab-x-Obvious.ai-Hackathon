import { describe, expect, it } from 'vitest';
import { VideoClip } from '../types';
import { opDuration, sourceTimeRange } from './objectSurgery';

function makeClip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    id: 'clip-1',
    file: undefined as unknown as File,
    url: 'file:///test.mp4',
    duration: 10,
    startTime: 0,
    name: 'test.mp4',
    ...overrides,
  };
}

describe('sourceTimeRange', () => {
  it('maps the op window onto the source file when the clip starts at 0', () => {
    const { srcStart, srcEnd } = sourceTimeRange(makeClip(), 2, 6);
    expect(srcStart).toBeCloseTo(2);
    expect(srcEnd).toBeCloseTo(6);
  });

  it('subtracts the clip start on a chained timeline', () => {
    const { srcStart, srcEnd } = sourceTimeRange(makeClip({ startTime: 8 }), 10, 13);
    expect(srcStart).toBeCloseTo(2);
    expect(srcEnd).toBeCloseTo(5);
  });

  it('adds trimStart — the source offset the trims skip', () => {
    const { srcStart, srcEnd } = sourceTimeRange(makeClip({ startTime: 0, trimStart: 1.5 }), 2, 6);
    expect(srcStart).toBeCloseTo(3.5);
    expect(srcEnd).toBeCloseTo(7.5);
  });

  it('composes trimStart with a chained clip start', () => {
    const { srcStart, srcEnd } = sourceTimeRange(makeClip({ startTime: 8, trimStart: 2 }), 10, 13);
    expect(srcStart).toBeCloseTo(4);
    expect(srcEnd).toBeCloseTo(7);
  });

  it('clamps a negative source start to zero', () => {
    const { srcStart } = sourceTimeRange(makeClip({ trimStart: 0 }), 0, 3);
    expect(srcStart).toBe(0);
  });

  it('rejects empty and inverted windows', () => {
    expect(() => sourceTimeRange(makeClip(), 5, 5)).toThrow(/Invalid op window/);
    expect(() => sourceTimeRange(makeClip(), 7, 3)).toThrow(/Invalid op window/);
  });
});

describe('opDuration', () => {
  it('is the window length in seconds', () => {
    expect(opDuration(3, 7)).toBeCloseTo(4);
    expect(opDuration(0, 2.5)).toBeCloseTo(2.5);
  });
});
