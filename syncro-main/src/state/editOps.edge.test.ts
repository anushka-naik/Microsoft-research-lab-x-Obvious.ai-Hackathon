import { describe, expect, it } from 'vitest';
import type { VideoClip } from '../types';
import {
  EditOp,
  applyOpsAtTime,
  clipActiveWindow,
  createObjectInsertOp,
  createObjectRemoveOp,
  createTextOverlayOp,
  createTrimOp,
  editorReducer,
  initialEditorState,
  resolveClips,
} from './editOps';

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases for the EditOp journal, complementing editOps.test.ts:
// overlapping ops at one timestamp, deleting applied ops from mid-journal,
// undo/redo across trim boundaries, ops referencing clipped-out ranges, and
// idempotent replay at fractional timestamps.
// ═══════════════════════════════════════════════════════════════════════════

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

// overlay-model / style-grade ops have no exported factory — build them as the
// UI does, as raw journal entries (same shape styleGrade.test.ts uses).
function overlayModelOp(clipId: string, inSec: number, outSec: number, modelUrl: string): EditOp {
  return { id: `op-model-${inSec}-${outSec}`, clipId, inSec, outSec, status: 'applied', type: 'overlay-model', params: { modelUrl } };
}

function styleGradeOp(clipId: string, inSec: number, outSec: number): EditOp {
  return { id: `op-grade-${inSec}-${outSec}`, clipId, inSec, outSec, status: 'applied', type: 'style-grade', params: { styleBible: null } };
}

describe('overlapping ops at the same timestamp', () => {
  it('folds every applied range op covering t into drawOps in journal order', () => {
    const clip = makeClip();
    const remove = { ...createObjectRemoveOp(clip.id, 2, 8, { point: { x: 1, y: 1 } }), status: 'applied' as const, resultUrl: 'blob:rm' };
    const insert = { ...createObjectInsertOp(clip.id, 4, 6, { description: 'balloon' }), status: 'applied' as const, resultUrl: 'blob:in' };
    const model = overlayModelOp(clip.id, 3, 9, 'blob:model.glb');
    const grade = styleGradeOp(clip.id, 0, 10);
    const frame = applyOpsAtTime([clip], [remove, insert, model, grade], 5);
    expect(frame.drawOps).toEqual([
      { kind: 'object-remove', opId: remove.id, resultUrl: 'blob:rm' },
      { kind: 'object-insert', opId: insert.id, resultUrl: 'blob:in' },
      { kind: 'overlay-model', opId: model.id, modelUrl: 'blob:model.glb' },
      { kind: 'style-grade', opId: grade.id },
    ]);
  });

  it('two overlapping trims on the same clip replay last-write-wins', () => {
    const clip = makeClip();
    const win = clipActiveWindow(clip);
    const ops: EditOp[] = [
      createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 1, trimmedDuration: 8 }),
      createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 4, trimmedDuration: 3 }),
    ];
    const resolved = resolveClips([clip], ops);
    expect(resolved[0]).toMatchObject({ trimStart: 4, trimmedDuration: 3 });
  });

  it('overlapping text-overlay and range ops coexist — text lands last in drawOps', () => {
    const clip = makeClip();
    const remove = { ...createObjectRemoveOp(clip.id, 0, 10, { point: { x: 2, y: 2 } }), status: 'applied' as const };
    const overlay = createTextOverlayOp(clip.id, 0, 10, { text: 'Title' });
    const frame = applyOpsAtTime([clip], [overlay, remove], 5);
    expect(frame.drawOps).toEqual([
      { kind: 'object-remove', opId: remove.id, resultUrl: undefined },
      { kind: 'text-overlay', text: 'Title' },
    ]);
  });
});

describe('deleting an applied op', () => {
  function stateWithOps(...ops: EditOp[]) {
    const sourceClips = [makeClip()];
    return { ...initialEditorState, sourceClips, ops, historyIndex: ops.length, clips: resolveClips(sourceClips, ops) };
  }

  it('removing a mid-journal op clamps the history pointer and replays the rest', () => {
    const clip = makeClip();
    const win = clipActiveWindow(clip);
    const first = createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 1, trimmedDuration: 8 });
    const overlay = createTextOverlayOp(clip.id, win.inSec, win.outSec, { text: 'Keep' });
    const second = createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 3, trimmedDuration: 5 });
    const state = stateWithOps(first, overlay, second);
    expect(state.historyIndex).toBe(3);

    const removed = editorReducer(state, { type: 'remove-op', opId: overlay.id });
    expect(removed.ops.map(o => o.id)).toEqual([first.id, second.id]);
    expect(removed.historyIndex).toBe(2);
    // The remaining trims still replay onto the read model.
    expect(removed.clips[0]).toMatchObject({ trimStart: 3, trimmedDuration: 5 });
  });

  it('removing an undone (future) op leaves the history pointer at its own index', () => {
    const clip = makeClip();
    const win = clipActiveWindow(clip);
    const first = createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 1, trimmedDuration: 8 });
    const future = createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 3, trimmedDuration: 5 });
    const state = stateWithOps(first, future);
    const undone = editorReducer(state, { type: 'undo' });
    expect(undone.historyIndex).toBe(1);

    const removed = editorReducer(undone, { type: 'remove-op', opId: future.id });
    expect(removed.ops.map(o => o.id)).toEqual([first.id]);
    expect(removed.historyIndex).toBe(1);
    expect(removed.clips[0].trimStart).toBe(1);
  });

  it('removing an unknown op id is a no-op on ops and history', () => {
    const clip = makeClip();
    const win = clipActiveWindow(clip);
    const state = stateWithOps(createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 2 }));
    const removed = editorReducer(state, { type: 'remove-op', opId: 'op-does-not-exist' });
    expect(removed.ops).toEqual(state.ops);
    expect(removed.historyIndex).toBe(state.historyIndex);
  });
});

describe('undo/redo across trim boundaries', () => {
  it('walks a chain of trims back and forward, restoring each boundary exactly', () => {
    const clip = makeClip();
    const win = clipActiveWindow(clip);
    const trims = [
      createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 1, trimmedDuration: 8 }),
      createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 2.5, trimmedDuration: 6.5, startTime: 0.5 }),
      createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 4, trimmedDuration: 4, startTime: 1 }),
    ];
    let state = { ...initialEditorState, sourceClips: [clip], clips: [clip] };
    for (const op of trims) state = editorReducer(state, { type: 'commit-op', op });

    const expectations: Array<Record<string, number | undefined>> = [
      { trimStart: 4, trimmedDuration: 4, startTime: 1 },
      { trimStart: 2.5, trimmedDuration: 6.5, startTime: 0.5 },
      { trimStart: 1, trimmedDuration: 8, startTime: 0 },
    ];
    for (const expected of expectations) {
      expect(state.clips[0]).toMatchObject(expected);
      state = editorReducer(state, { type: 'undo' });
    }
    // One more undo reaches the pristine source: untrimmed, back at the head.
    expect(state.clips[0]).toMatchObject({ startTime: 0 });
    expect(state.clips[0].trimStart).toBeUndefined();
    expect(state.clips[0].trimmedDuration).toBeUndefined();
    expect(state.historyIndex).toBe(0);

    for (const expected of expectations.slice().reverse()) {
      state = editorReducer(state, { type: 'redo' });
      expect(state.clips[0]).toMatchObject(expected);
    }
    expect(state.historyIndex).toBe(3);
  });

  it('a trim commited after undo plays forward from the new boundary, not the old tail', () => {
    const clip = makeClip();
    const win = clipActiveWindow(clip);
    const first = createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 1, trimmedDuration: 8 });
    let state = { ...initialEditorState, sourceClips: [clip], clips: [clip] };
    state = editorReducer(state, { type: 'commit-op', op: first });
    state = editorReducer(state, { type: 'undo' });

    const branched = createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 5, trimmedDuration: 3 });
    state = editorReducer(state, { type: 'commit-op', op: branched });
    expect(state.ops).toEqual([branched]);
    expect(state.clips[0]).toMatchObject({ trimStart: 5, trimmedDuration: 3 });
    // Redo cannot resurrect the abandoned first trim.
    expect(editorReducer(state, { type: 'redo' })).toBe(state);
  });
});

describe('ops referencing clipped-out ranges', () => {
  // Range-op windows are PROJECT-timeline seconds (see OpBase.inSec), so an op
  // "clipped out" means one whose window lies outside every clip's active
  // window. Under loop: false the timeline is simply past its end there.
  it('folds no range ops once the timeline is past the last clip (loop: false)', () => {
    const clip = makeClip({ duration: 5 }); // active 0–5
    const op = { ...createObjectRemoveOp(clip.id, 7, 9, { point: { x: 1, y: 1 } }), status: 'applied' as const };
    for (const t of [6, 8]) {
      const frame = applyOpsAtTime([clip], [op], t, { loop: false });
      expect(frame.clip).toBeNull();
      expect(frame.drawOps).toEqual([]);
    }
  });

  it('a looped timeline folds range ops by raw project time, not the looped instant', () => {
    // Clip active 0–5 on an infinite loop; the op window 7–9 is live at raw
    // t=8 even though playback there shows looped second 3. Documented
    // behavior of the current fold — pinning it so a change is deliberate.
    const clip = makeClip({ duration: 5 });
    const op = { ...createObjectRemoveOp(clip.id, 7, 9, { point: { x: 1, y: 1 } }), status: 'applied' as const };
    expect(applyOpsAtTime([clip], [op], 8).drawOps).toHaveLength(1);
    expect(applyOpsAtTime([clip], [op], 6).drawOps).toEqual([]);
  });

  it('ignores a range op whose clip is not the active one at t', () => {
    const a = makeClip({ id: 'a', startTime: 0, duration: 5 });
    const b = makeClip({ id: 'b', startTime: 5, duration: 5 });
    const op = { ...createObjectRemoveOp('b', 0, 10, { point: { x: 1, y: 1 } }), status: 'applied' as const };
    expect(applyOpsAtTime([a, b], [op], 2).drawOps).toEqual([]);
    expect(applyOpsAtTime([a, b], [op], 7).drawOps).toHaveLength(1);
  });

  it('an op window straddling the clip boundary folds only inside it', () => {
    const clip = makeClip({ duration: 5 });
    const op = { ...createObjectRemoveOp(clip.id, 4, 7, { point: { x: 1, y: 1 } }), status: 'applied' as const };
    expect(applyOpsAtTime([clip], [op], 4.999, { loop: false }).drawOps).toHaveLength(1);
    expect(applyOpsAtTime([clip], [op], 5, { loop: false }).drawOps).toEqual([]);
  });
});

describe('idempotent replay at fractional timestamps', () => {
  it('repeated calls at fractional timestamps return deeply identical instructions', () => {
    const clip = makeClip({ duration: 10, trimStart: 0.5, trimmedDuration: 9.5, transitionIn: 'dissolve' });
    const remove = { ...createObjectRemoveOp(clip.id, 2, 6, { point: { x: 1, y: 1 } }), status: 'applied' as const };
    const overlay = createTextOverlayOp(clip.id, 0, 10, { text: 'Fractions' });
    for (const t of [0, 0.1, 0.333333, 1.5, 2.0001, 3.14159, 5.999999, 6, 9.4999]) {
      const first = applyOpsAtTime([clip], [remove, overlay], t);
      expect(applyOpsAtTime([clip], [remove, overlay], t)).toEqual(first);
    }
  });

  it('replaying the same op list twice resolves to the same read model', () => {
    const clip = makeClip();
    const win = clipActiveWindow(clip);
    const ops: EditOp[] = [
      createTrimOp(clip.id, win.inSec, win.outSec, { trimStart: 2.5, trimmedDuration: 6.5 }),
      createTextOverlayOp(clip.id, win.inSec, win.outSec, { text: 'Once' }),
    ];
    const once = resolveClips([clip], ops);
    const twice = resolveClips(once, ops);
    expect(twice).toEqual(once);
    expect(twice[0]).toMatchObject({ trimStart: 2.5, trimmedDuration: 6.5, textOverlay: 'Once' });
  });

  it('range ops honor half-open windows at fractional boundaries: inSec in, outSec out', () => {
    const clip = makeClip({ duration: 10 });
    const op = { ...createObjectRemoveOp(clip.id, 3.25, 5.75, { point: { x: 1, y: 1 } }), status: 'applied' as const };
    expect(applyOpsAtTime([clip], [op], 3.25).drawOps).toHaveLength(1);
    expect(applyOpsAtTime([clip], [op], 5.749999).drawOps).toHaveLength(1);
    expect(applyOpsAtTime([clip], [op], 5.75).drawOps).toEqual([]);
    expect(applyOpsAtTime([clip], [op], 3.249999).drawOps).toEqual([]);
  });
});
