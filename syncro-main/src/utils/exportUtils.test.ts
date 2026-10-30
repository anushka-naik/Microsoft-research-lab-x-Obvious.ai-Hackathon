import { describe, expect, it } from 'vitest';
import { VideoClip } from '../types';
import { effectiveClipDuration, getClipAtTime } from './exportUtils';

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

describe('effectiveClipDuration', () => {
  it('returns the full duration when untrimmed', () => {
    expect(effectiveClipDuration(makeClip())).toBe(10);
  });

  it('returns the trimmed duration when trimmed', () => {
    expect(effectiveClipDuration(makeClip({ trimmedDuration: 5, trimStart: 2 }))).toBe(5);
  });
});

describe('getClipAtTime (trim-aware lookup)', () => {
  it('untrimmed clip resolves localTime as a plain offset', () => {
    const hit = getClipAtTime([makeClip()], 3);
    expect(hit?.clip.id).toBe('clip-1');
    expect(hit?.localTime).toBe(3);
  });

  it('a clip with trimStart>0 resolves the correct source offset (the trim bug)', () => {
    // Plays source seconds [2, 7) on timeline seconds [0, 5).
    const clip = makeClip({ trimStart: 2, trimmedDuration: 5 });
    expect(getClipAtTime([clip], 0)?.localTime).toBe(2);
    expect(getClipAtTime([clip], 2.5)?.localTime).toBe(4.5);
    expect(getClipAtTime([clip], 4.9)?.localTime).toBe(6.9);
  });

  it('a trimmed clip ends at startTime + effectiveDuration, not startTime + duration', () => {
    const clip = makeClip({ trimStart: 2, trimmedDuration: 5 });
    expect(getClipAtTime([clip], 4.9)?.clip.id).toBe('clip-1');
    expect(getClipAtTime([clip], 5, { loop: false })).toBeNull();
  });

  it('the next clip starts when the trimmed clip ends', () => {
    const a = makeClip({ id: 'a', trimStart: 2, trimmedDuration: 5, startTime: 0 });
    const b = makeClip({ id: 'b', startTime: 5 });
    expect(getClipAtTime([a, b], 5)?.clip.id).toBe('b');
    expect(getClipAtTime([a, b], 5)?.localTime).toBe(0);
  });

  it('looped playback accumulates effective durations and applies trimStart', () => {
    const a = makeClip({ id: 'a', duration: 10, trimStart: 2, trimmedDuration: 5, startTime: 0 });
    const b = makeClip({ id: 'b', duration: 4, startTime: 5 });
    // Effective total = 5 + 4 = 9. Looping t=9 wraps to the head of clip a,
    // which shows source second 2 (trimStart), not source second 0.
    expect(getClipAtTime([a, b], 9)).toEqual({ clip: a, localTime: 2 });
    // Wrapping into b mid-loop keeps plain offsets.
    expect(getClipAtTime([a, b], 7)?.clip.id).toBe('b');
    expect(getClipAtTime([a, b], 7)?.localTime).toBe(2);
  });

  it('loop: false returns null past the end instead of wrapping', () => {
    const clip = makeClip({ duration: 5 });
    expect(getClipAtTime([clip], 7, { loop: false })).toBeNull();
  });
});
