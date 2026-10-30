import { describe, expect, it } from 'vitest';
import { VideoClip } from '../types';
import {
  EditOp,
  EditorState,
  TRANSITION_DURATION_SEC,
  applyOpsAtTime,
  clipActiveWindow,
  createMoveOp,
  createTextOverlayOp,
  createTransitionOp,
  createTrimOp,
  editorReducer,
  initialEditorState,
  resolveClips,
} from './editOps';

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

/** An applied trim op over a clip's current window, as the UI commits it. */
function trimOpFor(clip: VideoClip, trimStart: number, trimmedDuration?: number): EditOp {
  const win = clipActiveWindow(clip);
  return createTrimOp(clip.id, win.inSec, win.outSec, { trimStart, trimmedDuration });
}

describe('resolveClips', () => {
  it('replays trim, move, transition, and text-overlay ops onto the read model', () => {
    const source = makeClip();
    const win = clipActiveWindow(source);
    const ops: EditOp[] = [
      createTrimOp(source.id, win.inSec, win.outSec, { trimStart: 2, trimmedDuration: 5 }),
      createMoveOp(source.id, 0, 5, { startTime: 3, track: 1 }),
      createTransitionOp(source.id, 3, 8, { transitionIn: 'fade' }),
      createTextOverlayOp(source.id, 3, 8, { text: 'Hello' }),
    ];
    const resolved = resolveClips([source], ops);
    expect(resolved[0]).toMatchObject({
      trimStart: 2,
      trimmedDuration: 5,
      startTime: 3,
      track: 1,
      transitionIn: 'fade',
      textOverlay: 'Hello',
    });
  });

  it('never mutates the source clips', () => {
    const source = makeClip();
    const snapshot = JSON.stringify(source);
    const win = clipActiveWindow(source);
    resolveClips([source], [createTrimOp(source.id, win.inSec, win.outSec, { trimStart: 4, trimmedDuration: 6 })]);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('normalizes trimStart 0 to undefined (untrimmed)', () => {
    const source = makeClip();
    const win = clipActiveWindow(source);
    const resolved = resolveClips([source], [createTrimOp(source.id, win.inSec, win.outSec, { trimStart: 0, trimmedDuration: undefined })]);
    expect(resolved[0].trimStart).toBeUndefined();
    expect(resolved[0].trimmedDuration).toBeUndefined();
  });

  it('replays the timeline shift a left-trim carries in startTime (regression: trim ops omitting the shift snapped clips back)', () => {
    const source = makeClip({ startTime: 5 });
    const win = clipActiveWindow(source);
    // Left-trim drag as the UI commits it: head shortened, start shifted right by 1.5s.
    const resolved = resolveClips([source], [createTrimOp(source.id, 6.5, 10, { trimStart: 1.5, trimmedDuration: 3.5, startTime: 6.5 })]);
    expect(resolved[0].startTime).toBe(6.5);
    expect(resolved[0].trimStart).toBe(1.5);
    expect(resolved[0].trimmedDuration).toBe(3.5);
  });

  it('leaves startTime untouched when a trim op omits it (older journals stay valid)', () => {
    const source = makeClip({ startTime: 5 });
    const win = clipActiveWindow(source);
    const resolved = resolveClips([source], [createTrimOp(source.id, win.inSec, win.outSec, { trimStart: 2, trimmedDuration: 5 })]);
    expect(resolved[0].startTime).toBe(5);
  });
});

describe('applyOpsAtTime', () => {
  it('is deterministic: same inputs produce identical instructions', () => {
    const clips = [
      makeClip({ id: 'a', startTime: 0, duration: 10 }),
      makeClip({ id: 'b', startTime: 10, duration: 8, transitionIn: 'fade' }),
    ];
    const winB = clipActiveWindow(clips[1]);
    const ops: EditOp[] = [
      createTrimOp(clips[0].id, 0, 10, { trimStart: 1, trimmedDuration: 10 }),
      createTextOverlayOp(clips[1].id, winB.inSec, winB.outSec, { text: 'Second clip' }),
    ];
    const times = [0, 0.25, 5, 10, 10.2, 17.9, 25];
    for (const t of times) {
      const x = applyOpsAtTime(clips, ops, t);
      const y = applyOpsAtTime(clips, ops, t);
      expect(y).toEqual(x);
    }
  });

  it('respects trims: sourceOffset points into the source file', () => {
    const clips = [makeClip({ trimStart: 2, trimmedDuration: 5 })];
    const frame = applyOpsAtTime(clips, [], 2.5);
    expect(frame.clip?.id).toBe('clip-1');
    expect(frame.sourceOffset).toBe(4.5);
  });

  it('folds a text-overlay op on the active clip into drawOps', () => {
    const clip = makeClip();
    const win = clipActiveWindow(clip);
    const ops = [createTextOverlayOp(clip.id, win.inSec, win.outSec, { text: 'Hi mum' })];
    const frame = applyOpsAtTime([clip], ops, 4);
    expect(frame.drawOps).toEqual([{ kind: 'text-overlay', text: 'Hi mum' }]);
  });

  it('keeps the latest text-overlay op per clip (no stacked duplicates)', () => {
    const clip = makeClip();
    const win = clipActiveWindow(clip);
    const ops = [
      createTextOverlayOp(clip.id, win.inSec, win.outSec, { text: 'First' }),
      createTextOverlayOp(clip.id, win.inSec, win.outSec, { text: 'Second' }),
    ];
    const frame = applyOpsAtTime([clip], ops, 4);
    expect(frame.drawOps).toEqual([{ kind: 'text-overlay', text: 'Second' }]);
  });

  it('does not fold a text-overlay op while its clip is inactive', () => {
    const a = makeClip({ id: 'a', startTime: 0, duration: 5 });
    const b = makeClip({ id: 'b', startTime: 5, duration: 5 });
    const winB = clipActiveWindow(b);
    const ops = [createTextOverlayOp(b.id, winB.inSec, winB.outSec, { text: 'B only' })];
    expect(applyOpsAtTime([a, b], ops, 2).drawOps).toEqual([]);
    expect(applyOpsAtTime([a, b], ops, 7).drawOps).toEqual([{ kind: 'text-overlay', text: 'B only' }]);
  });

  it('ignores draft and failed ops', () => {
    const clip = makeClip();
    const win = clipActiveWindow(clip);
    const draft = { ...createTextOverlayOp(clip.id, win.inSec, win.outSec, { text: 'Nope' }), status: 'draft' as const };
    const failed = { ...createTextOverlayOp(clip.id, win.inSec, win.outSec, { text: 'Nope' }), status: 'failed' as const };
    expect(applyOpsAtTime([clip], [draft, failed], 4).drawOps).toEqual([]);
  });

  it('emits a transition with a 0→1 progress ramp and the outgoing clip beneath', () => {
    const a = makeClip({ id: 'a', startTime: 0, duration: 5 });
    const b = makeClip({ id: 'b', startTime: 5, duration: 5, transitionIn: 'fade' });
    const mid = applyOpsAtTime([a, b], [], 5 + TRANSITION_DURATION_SEC / 2);
    expect(mid.clip?.id).toBe('b');
    expect(mid.transition).toEqual({ type: 'fade', progress: 0.5 });
    expect(mid.opacity).toBe(0.5);
    expect(mid.underClip?.id).toBe('a');
    // The outgoing clip holds its final trimmed frame, not footage past its trim.
    expect(mid.underSourceOffset).toBe(5);

    const done = applyOpsAtTime([a, b], [], 5 + TRANSITION_DURATION_SEC);
    expect(done.transition).toBeNull();
    expect(done.opacity).toBe(1);
    expect(done.underClip).toBeNull();
  });

  it('fades from black (no under layer) for a first clip or a distant predecessor', () => {
    const a = makeClip({ id: 'a', startTime: 0, duration: 5, transitionIn: 'fade' });
    expect(applyOpsAtTime([a], [], 0.2).underClip).toBeNull();

    const far = makeClip({ id: 'far', startTime: 0, duration: 3 });
    const b = makeClip({ id: 'b', startTime: 10, duration: 5, transitionIn: 'dissolve' });
    expect(applyOpsAtTime([far, b], [], 10.2).underClip).toBeNull();
  });

  it('returns a null-clip instruction with loop: false past the end', () => {
    const clip = makeClip({ duration: 5 });
    const frame = applyOpsAtTime([clip], [], 8, { loop: false });
    expect(frame.clip).toBeNull();
    expect(frame.drawOps).toEqual([]);
  });
});

describe('editorReducer', () => {
  function stateWith(...ops: EditOp[]): EditorState {
    const sourceClips = [makeClip()];
    return { ...initialEditorState, sourceClips, ops, historyIndex: ops.length, clips: resolveClips(sourceClips, ops) };
  }

  it('commit-op appends, moves the pointer, and recomputes the read model', () => {
    const clip = makeClip();
    const state: EditorState = { ...initialEditorState, sourceClips: [clip], clips: [clip] };
    const op = trimOpFor(clip, 2, 5);
    const next = editorReducer(state, { type: 'commit-op', op });
    expect(next.ops).toHaveLength(1);
    expect(next.historyIndex).toBe(1);
    expect(next.clips[0].trimStart).toBe(2);
    expect(next.clips[0].trimmedDuration).toBe(5);
  });

  it('undo restores the prior journal state and redo re-applies it', () => {
    const clip = makeClip();
    const state = stateWith(trimOpFor(clip, 2, 5));
    const undone = editorReducer(state, { type: 'undo' });
    expect(undone.historyIndex).toBe(0);
    expect(undone.clips[0].trimStart).toBeUndefined();
    expect(undone.ops).toHaveLength(1);

    const redone = editorReducer(undone, { type: 'redo' });
    expect(redone.historyIndex).toBe(1);
    expect(redone.clips[0].trimStart).toBe(2);
    expect(redone.clips[0].trimmedDuration).toBe(5);
  });

  it('undo and redo are no-ops at the journal boundaries', () => {
    const clip = makeClip();
    const state = stateWith(trimOpFor(clip, 2, 5));
    expect(editorReducer(state, { type: 'redo' })).toBe(state);
    const onceUndone = editorReducer(state, { type: 'undo' });
    expect(editorReducer(onceUndone, { type: 'undo' })).toBe(onceUndone);
  });

  it('a commit after undo truncates the redo tail', () => {
    const clip = makeClip();
    const state = stateWith(trimOpFor(clip, 2, 5));
    const undone = editorReducer(state, { type: 'undo' });
    const branch = editorReducer(undone, { type: 'commit-op', op: trimOpFor(clip, 4, 6) });
    expect(branch.ops).toHaveLength(1);
    expect(branch.ops[0].type).toBe('trim');
    expect((branch.ops[0] as Extract<EditOp, { type: 'trim' }>).params.trimStart).toBe(4);
    expect(branch.historyIndex).toBe(1);
  });

  it('set-op-status drives the op lifecycle without changing history length', () => {
    const clip = makeClip();
    const op = { ...trimOpFor(clip, 2, 5), status: 'draft' as const };
    const state = editorReducer({ ...initialEditorState, sourceClips: [clip] }, { type: 'commit-op', op });
    const failed = editorReducer(state, { type: 'set-op-status', opId: op.id, status: 'failed' });
    expect(failed.ops[0].status).toBe('failed');
    expect(failed.historyIndex).toBe(state.historyIndex);
    const applied = editorReducer(failed, { type: 'set-op-status', opId: op.id, status: 'applied', resultUrl: 'blob:x' });
    expect(applied.ops[0].status).toBe('applied');
    expect(applied.ops[0].resultUrl).toBe('blob:x');
  });

  it('remove-op drops the op and clamps the history pointer', () => {
    const clip = makeClip();
    const op = trimOpFor(clip, 2, 5);
    const state = editorReducer({ ...initialEditorState, sourceClips: [clip] }, { type: 'commit-op', op });
    const removed = editorReducer(state, { type: 'remove-op', opId: op.id });
    expect(removed.ops).toHaveLength(0);
    expect(removed.historyIndex).toBe(0);
    expect(removed.clips[0].trimStart).toBeUndefined();
  });

  it('transient-clips updates the read model without touching the journal', () => {
    const clip = makeClip();
    const state = stateWith(trimOpFor(clip, 2, 5));
    const transient = editorReducer(state, { type: 'transient-clips', clips: [{ ...state.clips[0], startTime: 9 }] });
    expect(transient.clips[0].startTime).toBe(9);
    expect(transient.ops).toEqual(state.ops);
    expect(transient.historyIndex).toBe(state.historyIndex);
    expect(transient.sourceClips).toEqual(state.sourceClips);
  });

  it('composition changes bake resolved values and reset the journal', () => {
    const clip = makeClip();
    const state = stateWith(trimOpFor(clip, 2, 5));
    const next = editorReducer(state, { type: 'set-clips', clips: [{ ...state.clips[0], startTime: 0 }] });
    expect(next.ops).toHaveLength(0);
    expect(next.historyIndex).toBe(0);
    // The trim survived as a baked value on the new source material…
    expect(next.sourceClips[0].trimStart).toBe(2);
    expect(next.sourceClips[0].trimmedDuration).toBe(5);
    // …so an undo after the bake cannot resurrect a stale op.
    const undone = editorReducer(next, { type: 'undo' });
    expect(undone).toBe(next);
  });

  it('add-clips appends to the current composition', () => {
    const clip = makeClip();
    const state: EditorState = { ...initialEditorState, sourceClips: [clip], clips: [clip] };
    const added = makeClip({ id: 'clip-2', startTime: 10 });
    const next = editorReducer(state, { type: 'add-clips', clips: [added] });
    expect(next.clips.map(c => c.id)).toEqual(['clip-1', 'clip-2']);
  });

  it('update-analysis merges analysis without clearing the journal', () => {
    const clip = makeClip();
    const state = stateWith(trimOpFor(clip, 2, 5));
    const next = editorReducer(state, { type: 'update-analysis', updates: [{ id: clip.id, analysis: 'A cat walks' }] });
    expect(next.sourceClips[0].analysis).toBe('A cat walks');
    expect(next.ops).toHaveLength(1);
    expect(next.clips[0].trimStart).toBe(2);
    expect(next.clips[0].analysis).toBe('A cat walks');
  });
});
