import { CaptionMode, TransitionType, VideoClip } from '../types';
import { getClipAtTime } from '../utils/exportUtils';

// ═══════════════════════════════════════════════════════════════════════════
// EditOp journal — the non-destructive editing substrate.
//
// Every user edit is an op appended to a journal. Clips are source material:
// the reducer never rewrites them, it replays ops into a resolved read model
// (resolveClips). Preview and export both consume FrameInstructions produced
// by applyOpsAtTime, so what the editor shows is what the export renders.
// ═══════════════════════════════════════════════════════════════════════════

/** Duration of the transition-in window at the head of a clip, in seconds. Matches the preview's historical TRANS_DUR. */
export const TRANSITION_DURATION_SEC = 0.5;

export type EditOpStatus = 'draft' | 'applied' | 'failed';

/** Seconds into the original source file a clip starts playing (0 = from the head).
 *  `startTime` is the clip's absolute timeline start: left-trim drags shift it, and
 *  the op must carry it or replay snaps the clip back to its pre-drag position. */
export type TrimOpParams = { trimStart: number; trimmedDuration?: number; startTime?: number };
export type MoveOpParams = { startTime: number; track: number };
export type TransitionOpParams = { transitionIn: TransitionType };
export type TextOverlayOpParams = { text: string };
export interface ObjectRemoveOpParams { point?: { x: number; y: number }; maskDataUrl?: string }
export interface ObjectInsertOpParams { description: string; point?: { x: number; y: number } }
export interface OverlayModelOpParams {
  modelUrl: string;
  position?: { x: number; y: number };
  scale?: number;
  rotationYDeg?: number;
}
export type StyleGradeOpParams = { styleBible: StyleBible | null };

interface OpBase {
  id: string;
  clipId: string;
  /** Op window on the project timeline, in seconds. Structural ops (trim/move/transition/text-overlay) set it to the clip's active window at dispatch time; range ops (object/model/grade) are applied only inside [inSec, outSec). */
  inSec: number;
  outSec: number;
  status: EditOpStatus;
  /** Pre-rendered generative result (e.g. a blob URL for a regenerated segment). */
  resultUrl?: string;
}

export interface TrimOp extends OpBase { type: 'trim'; params: TrimOpParams }
export interface MoveOp extends OpBase { type: 'move'; params: MoveOpParams }
export interface TransitionOp extends OpBase { type: 'transition'; params: TransitionOpParams }
export interface TextOverlayOp extends OpBase { type: 'text-overlay'; params: TextOverlayOpParams }
export interface ObjectRemoveOp extends OpBase { type: 'object-remove'; params: ObjectRemoveOpParams }
export interface ObjectInsertOp extends OpBase { type: 'object-insert'; params: ObjectInsertOpParams }
export interface OverlayModelOp extends OpBase { type: 'overlay-model'; params: OverlayModelOpParams }
export interface StyleGradeOp extends OpBase { type: 'style-grade'; params: StyleGradeOpParams }

/** Discriminated on `type`; every member carries the OpBase fields. */
export type EditOp =
  | TrimOp
  | MoveOp
  | TransitionOp
  | TextOverlayOp
  | ObjectRemoveOp
  | ObjectInsertOp
  | OverlayModelOp
  | StyleGradeOp;

export type EditOpType = EditOp['type'];

// ── Style Bible (constraint object shared by render paths and AI passes) ────

export interface StyleBible {
  grade: {
    brightness: number;
    contrast: number;
    saturation: number;
    /** -1 cool … 1 warm */
    temperature: number;
    /** 0–1, drawn as a radial gradient on canvas. */
    vignette: number;
  };
  captions: {
    font: string;
    fontSize: number;
    color: string;
    bg: string;
    position: 'bottom' | 'top';
    mode: CaptionMode;
  };
  transitions: {
    allowed: TransitionType[];
    defaultDurationSec: number;
  };
  pacing: {
    avgCutLengthSec: number;
    minCutLengthSec: number;
  };
  overlayTypography: {
    font: string;
    weight: number;
    color: string;
    shadow: boolean;
  };
}

// ── FrameInstructions — the single contract between the journal and pixels ──

export type DrawOp =
  | { kind: 'text-overlay'; text: string }
  | { kind: 'object-remove'; opId: string; resultUrl?: string }
  | { kind: 'object-insert'; opId: string; resultUrl?: string }
  | { kind: 'overlay-model'; opId: string; modelUrl?: string }
  | { kind: 'style-grade'; opId: string };

/** What a renderer must draw at one instant of the project timeline. Pure data — no DOM, no canvas. */
export interface FrameInstruction {
  /** Clip whose content is active at t (top layer). Null when the timeline is empty or, without looping, past the end. */
  clip: VideoClip | null;
  /** Seconds into the clip's SOURCE file to display (trimStart already applied). */
  sourceOffset: number;
  /** Clip visible beneath during a transition-in window (holds its final trimmed frame). */
  underClip: VideoClip | null;
  underSourceOffset: number;
  /** Opacity of the active layer: transition progress for fade/dissolve, 1 otherwise. */
  opacity: number;
  /** Transition applying to the active clip at t (null = none or 'cut'). */
  transition: { type: TransitionType; progress: number } | null;
  /** Time-folded overlay ops covering t, in journal order. */
  drawOps: DrawOp[];
}

// ── Op factories ─────────────────────────────────────────────────────────────

let opCounter = 0;

function nextOpId(): string {
  opCounter += 1;
  const uid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${opCounter}`;
  return `op-${uid}`;
}

function baseOp(clipId: string, inSec: number, outSec: number): { id: string; clipId: string; inSec: number; outSec: number; status: EditOpStatus } {
  return { id: nextOpId(), clipId, inSec, outSec, status: 'applied' };
}

export function createTrimOp(clipId: string, inSec: number, outSec: number, params: TrimOpParams): TrimOp {
  return { ...baseOp(clipId, inSec, outSec), type: 'trim', params };
}

export function createMoveOp(clipId: string, inSec: number, outSec: number, params: MoveOpParams): MoveOp {
  return { ...baseOp(clipId, inSec, outSec), type: 'move', params };
}

export function createTransitionOp(clipId: string, inSec: number, outSec: number, params: TransitionOpParams): TransitionOp {
  return { ...baseOp(clipId, inSec, outSec), type: 'transition', params };
}

export function createTextOverlayOp(clipId: string, inSec: number, outSec: number, params: TextOverlayOpParams): TextOverlayOp {
  return { ...baseOp(clipId, inSec, outSec), type: 'text-overlay', params };
}

// ── Op resolution ────────────────────────────────────────────────────────────

/** A clip's playback window on the project timeline. */
export function clipActiveWindow(clip: VideoClip): { inSec: number; outSec: number } {
  const eff = clip.trimmedDuration ?? clip.duration;
  return { inSec: clip.startTime, outSec: clip.startTime + eff };
}

/**
 * Replay structural ops (trim/move/transition/text-overlay) over source clips,
 * producing the read model the UI renders. Absolute-value ops replay
 * idempotently (last write wins per journal order); sourceClips are never
 * mutated. Range/generative ops do not reshape clip geometry and are skipped.
 */
export function resolveClips(sourceClips: VideoClip[], ops: EditOp[]): VideoClip[] {
  let clips = sourceClips;
  for (const op of ops) {
    switch (op.type) {
      case 'trim':
        clips = clips.map(c => c.id === op.clipId
          ? {
              ...c,
              trimStart: op.params.trimStart > 0 ? op.params.trimStart : undefined,
              trimmedDuration: op.params.trimmedDuration,
              startTime: op.params.startTime ?? c.startTime,
            }
          : c);
        break;
      case 'move':
        clips = clips.map(c => c.id === op.clipId
          ? { ...c, startTime: op.params.startTime, track: op.params.track }
          : c);
        break;
      case 'transition':
        clips = clips.map(c => c.id === op.clipId
          ? { ...c, transitionIn: op.params.transitionIn }
          : c);
        break;
      case 'text-overlay':
        // Baked for editor convenience (ClipEditor initial value); render paths
        // must read text from FrameInstruction.drawOps, never from this field.
        clips = clips.map(c => c.id === op.clipId
          ? { ...c, textOverlay: op.params.text || undefined }
          : c);
        break;
      default:
        break;
    }
  }
  return clips;
}

/**
 * Find the same-track clip directly beneath `active` for a crossfade: the clip
 * whose playback window ends nearest at (or just before) the active clip's
 * start, within the adjacency tolerance the transition badge uses (0.5s).
 */
function findUnderClip(clips: VideoClip[], active: VideoClip): VideoClip | null {
  const track = active.track ?? 0;
  let best: VideoClip | null = null;
  let bestGap = Infinity;
  for (const c of clips) {
    if (c.id === active.id || (c.track ?? 0) !== track) continue;
    const gap = active.startTime - clipActiveWindow(c).outSec;
    if (gap >= -0.001 && gap < 0.5 && gap < bestGap) {
      best = c;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * THE contract: fold the timeline at instant `t` into one FrameInstruction.
 *
 * `clips` must be the op-resolved view (see resolveClips) — structural ops are
 * already baked into it and are inert here; `ops` is folded for the
 * time-anchored effects (text overlays today; object/model/grade ops as they
 * land). Pure and deterministic: same inputs, same instruction.
 */
export function applyOpsAtTime(
  clips: VideoClip[],
  ops: EditOp[],
  t: number,
  options: { loop?: boolean } = {},
): FrameInstruction {
  const { loop = true } = options;
  const hit = getClipAtTime(clips, t, { loop });
  if (!hit) {
    return { clip: null, sourceOffset: 0, underClip: null, underSourceOffset: 0, opacity: 1, transition: null, drawOps: [] };
  }

  // Transition-in window at the head of the active clip.
  let transition: FrameInstruction['transition'] = null;
  let underClip: VideoClip | null = null;
  let underSourceOffset = 0;
  let opacity = 1;
  const transIn = hit.clip.transitionIn;
  if (transIn && transIn !== 'cut') {
    const elapsedInClip = t - hit.clip.startTime;
    if (elapsedInClip < TRANSITION_DURATION_SEC) {
      const progress = Math.min(1, Math.max(0, elapsedInClip / TRANSITION_DURATION_SEC));
      transition = { type: transIn, progress };
      // Wipe reveals the incoming frame with a clip rect (opacity stays 1);
      // fade/dissolve ramp the incoming frame's alpha over the outgoing one.
      opacity = transIn === 'wipe' ? 1 : progress;
      const under = findUnderClip(clips, hit.clip);
      if (under) {
        const win = clipActiveWindow(under);
        // Hold the under layer at its final trimmed frame — never bleed into untrimmed footage.
        const raw = (t - under.startTime) + (under.trimStart ?? 0);
        const finalSourceOffset = win.outSec - under.startTime + (under.trimStart ?? 0);
        underClip = under;
        underSourceOffset = Math.min(raw, finalSourceOffset);
      }
    }
  }

  // Fold time-anchored ops into draw instructions.
  const drawOps: DrawOp[] = [];
  const latestTextByClip = new Map<string, string>();
  for (const op of ops) {
    if (op.status !== 'applied') continue;
    switch (op.type) {
      case 'text-overlay':
        // Clip-anchored: applies while its clip is active (survives moves/trims,
        // matching the historical per-clip overlay). Latest op wins.
        if (op.clipId === hit.clip.id && op.params.text) {
          latestTextByClip.set(op.clipId, op.params.text);
        }
        break;
      case 'object-remove':
      case 'object-insert':
        if (op.clipId === hit.clip.id && t >= op.inSec && t < op.outSec) {
          drawOps.push({ kind: op.type, opId: op.id, resultUrl: op.resultUrl });
        }
        break;
      case 'overlay-model':
        if (t >= op.inSec && t < op.outSec) {
          drawOps.push({ kind: 'overlay-model', opId: op.id, modelUrl: op.params.modelUrl });
        }
        break;
      case 'style-grade':
        if (t >= op.inSec && t < op.outSec) {
          drawOps.push({ kind: 'style-grade', opId: op.id });
        }
        break;
      case 'trim':
      case 'move':
      case 'transition':
        // Structural — already baked into the resolved clips.
        break;
    }
  }
  for (const text of latestTextByClip.values()) {
    drawOps.push({ kind: 'text-overlay', text });
  }

  return { clip: hit.clip, sourceOffset: hit.localTime, underClip, underSourceOffset, opacity, transition, drawOps };
}

// ── Editor state + reducer ───────────────────────────────────────────────────

export interface EditorState {
  /** Pristine source material for the current composition — never mutated. */
  sourceClips: VideoClip[];
  /** Resolved read model (= resolveClips(sourceClips, appliedOps)) — what the UI renders. */
  clips: VideoClip[];
  /** Append-only journal; ops[0..historyIndex) are applied. */
  ops: EditOp[];
  /** Undo = decrement, redo = increment; a new commit truncates the redo tail. */
  historyIndex: number;
  styleBible: StyleBible | null;
}

export type EditorAction =
  /** Composition change: upload. Bakes current values and resets the journal (ops from a prior generation would replay stale geometry). */
  | { type: 'add-clips'; clips: VideoClip[] }
  /** Composition change: delete/swap/AI-align re-chain. Bakes and resets the journal like add-clips. */
  | { type: 'set-clips'; clips: VideoClip[] }
  /** Live drag feedback — updates the read model only, never journaled. The follow-up commit-op carries the final absolute values. */
  | { type: 'transient-clips'; clips: VideoClip[] }
  /** Journal an edit and recompute the read model from source. */
  | { type: 'commit-op'; op: EditOp }
  | { type: 'undo' }
  | { type: 'redo' }
  /** Async op lifecycle (generative ops): draft → applied/failed. */
  | { type: 'set-op-status'; opId: string; status: EditOpStatus; resultUrl?: string }
  /** Reject a generative op (A/B toggle delete). */
  | { type: 'remove-op'; opId: string }
  /** Source-level metadata (AI analysis) — merges without disturbing the journal. */
  | { type: 'update-analysis'; updates: Array<{ id: string; analysis: string }> }
  | { type: 'set-style-bible'; styleBible: StyleBible | null };

export const initialEditorState: EditorState = {
  sourceClips: [],
  clips: [],
  ops: [],
  historyIndex: 0,
  styleBible: null,
};

function applyOpsToReadModel(state: EditorState, ops: EditOp[], historyIndex: number): EditorState {
  return { ...state, ops, historyIndex, clips: resolveClips(state.sourceClips, ops.slice(0, historyIndex)) };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'add-clips':
    case 'set-clips': {
      // Composition generations: bake the current resolved values into the new
      // source material and clear the journal — replaying a prior generation's
      // ops against a re-chained composition would corrupt geometry.
      const clips = action.type === 'add-clips' ? [...state.clips, ...action.clips] : action.clips;
      return { ...state, sourceClips: clips, clips, ops: [], historyIndex: 0 };
    }
    case 'transient-clips':
      return { ...state, clips: action.clips };
    case 'commit-op': {
      const ops = [...state.ops.slice(0, state.historyIndex), action.op];
      return applyOpsToReadModel(state, ops, ops.length);
    }
    case 'undo': {
      if (state.historyIndex === 0) return state;
      return applyOpsToReadModel(state, state.ops, state.historyIndex - 1);
    }
    case 'redo': {
      if (state.historyIndex >= state.ops.length) return state;
      return applyOpsToReadModel(state, state.ops, state.historyIndex + 1);
    }
    case 'set-op-status': {
      const ops = state.ops.map(op => op.id === action.opId
        ? { ...op, status: action.status, resultUrl: action.resultUrl ?? op.resultUrl }
        : op);
      return applyOpsToReadModel(state, ops, state.historyIndex);
    }
    case 'remove-op': {
      const ops = state.ops.filter(op => op.id !== action.opId);
      const historyIndex = Math.min(state.historyIndex, ops.length);
      return applyOpsToReadModel(state, ops, historyIndex);
    }
    case 'update-analysis': {
      const byId = new Map(action.updates.map(u => [u.id, u.analysis]));
      const sourceClips = state.sourceClips.map(c => byId.has(c.id) ? { ...c, analysis: byId.get(c.id) } : c);
      return { ...state, sourceClips, clips: resolveClips(sourceClips, state.ops.slice(0, state.historyIndex)) };
    }
    case 'set-style-bible':
      return { ...state, styleBible: action.styleBible };
    default:
      return state;
  }
}
