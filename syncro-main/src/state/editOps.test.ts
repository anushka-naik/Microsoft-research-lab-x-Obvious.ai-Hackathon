import { describe, expect, it } from 'vitest';
import { VideoClip } from '../types';
import {
  EditOp,
  EditorState,
  TRANSITION_DURATION_SEC,
  applyOpsAtTime,
  clipActiveWindow,
  createMoveOp,
  createObjectInsertOp,
  createObjectRemoveOp,
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

  it('a left trim repositions the clip via its startTime param', () => {
    const source = makeClip();
    const win = clipActiveWindow(source);
    // Dragging the left edge in by 2.92s both trims the head and moves the clip.
    const resolved = resolveClips([source], [createTrimOp(source.id, 2.92, 8, { trimStart: 2.92, trimmedDuration: 5.08, startTime: 2.92 })]);
    expect(resolved[0]).toMatchObject({ startTime: 2.92, trimStart: 2.92, trimmedDuration: 5.08 });
  });

  it('a trim op without startTime leaves the clip position alone', () => {
    const source = makeClip();
    const win = clipActiveWindow(source);
    const resolved = resolveClips([source], [createTrimOp(source.id, win.inSec, win.outSec, { trimStart: 1, trimmedDuration: 7 })]);
    expect(resolved[0].startTime).toBe(source.startTime);
  });

  it('clipActiveWindow respects a left trim when trimmedDuration is absent', () => {
    const source = makeClip(); // duration 10
    const leftTrimmed: VideoClip = { ...source, trimStart: 2 };
    const win = clipActiveWindow(leftTrimmed);
    expect(win.outSec - win.inSec).toBe(8);
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

// ── Generative op factories ─────────────────────────────────────────────────────────

describe('generative op factories', () => {
  it('createObjectRemoveOp produces a draft op carrying its params', () => {
    const op = createObjectRemoveOp('clip-1', 3, 7, { point: { x: 100, y: 80 }, backgroundPrompt: 'empty road' });
    expect(op.type).toBe('object-remove');
    expect(op.status).toBe('draft');
    expect(op.clipId).toBe('clip-1');
    expect(op.inSec).toBe(3);
    expect(op.outSec).toBe(7);
    expect(op.params.point).toEqual({ x: 100, y: 80 });
    expect(op.params.backgroundPrompt).toBe('empty road');
  });

  it('createObjectInsertOp produces a draft op carrying its description', () => {
    const op = createObjectInsertOp('clip-1', 1, 2, { description: 'red balloon', point: { x: 5, y: 5 } });
    expect(op.type).toBe('object-insert');
    expect(op.status).toBe('draft');
    expect(op.params.description).toBe('red balloon');
  });

  it('draft generative ops never render: applyOpsAtTime emits no drawOps for them', () => {
    const draft = createObjectRemoveOp('clip-1', 3, 7, { point: { x: 1, y: 1 } });
    const frame = applyOpsAtTime([makeClip()], [draft], 5);
    expect(frame.clip).not.toBeNull();
    expect(frame.drawOps).toHaveLength(0);
  });

  it('an applied generative op folds into drawOps only inside its window', () => {
    const draft = createObjectRemoveOp('clip-1', 3, 7, { point: { x: 1, y: 1 } });
    const applied = { ...draft, status: 'applied' as const, resultUrl: 'blob:seg' };
    const inside = applyOpsAtTime([makeClip()], [applied], 5);
    expect(inside.drawOps).toHaveLength(1);
    expect(inside.drawOps[0]).toMatchObject({ kind: 'object-remove', opId: applied.id, resultUrl: 'blob:seg' });
    const outside = applyOpsAtTime([makeClip()], [applied], 8);
    expect(outside.drawOps).toHaveLength(0);
  });
});
