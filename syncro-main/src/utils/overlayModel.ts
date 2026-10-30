// Pure keyframed-pose logic for overlay-model ops. Keyframes ride on the op as
// an extra, optional field so the EditOp contract in state/editOps.ts stays
// untouched; both the preview overlay and the export loop resolve the pose
// through this module, so the two surfaces agree by construction.
import type { OverlayModelOp } from '../state/editOps';

/** Normalized placement: x/y in [-1, 1] relative to frame center, y up. */
export interface ModelKeyframe {
  tSec: number;
  position: { x: number; y: number };
  scale: number;
  rotationYDeg: number;
}

/** OverlayModelOp optionally carrying a keyframed motion path (non-contract field). */
export type AnimatedOverlayModelOp = OverlayModelOp & { keyframes?: ModelKeyframe[] };

export function createOverlayModelOp(input: {
  clipId: string;
  inSec: number;
  outSec: number;
  modelUrl: string;
  position: { x: number; y: number };
  scale: number;
  rotationYDeg: number;
  keyframes?: ModelKeyframe[];
}): AnimatedOverlayModelOp {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `om-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const op: AnimatedOverlayModelOp = {
    id,
    type: 'overlay-model',
    clipId: input.clipId,
    inSec: input.inSec,
    outSec: input.outSec,
    status: 'applied',
    params: {
      modelUrl: input.modelUrl,
      position: input.position,
      scale: input.scale,
      rotationYDeg: input.rotationYDeg,
    },
  };
  if (input.keyframes) op.keyframes = input.keyframes;
  return op;
}

export interface ModelPose {
  /** Screen-space placement for drawImage onto a W×H frame. */
  rect: { dx: number; dy: number; dw: number; dh: number };
  /** Yaw applied to the model inside the 3D render. */
  rotationYDeg: number;
  /** Uniform model scale inside the 3D render. */
  scale: number;
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

const kfPose = (kf: ModelKeyframe): Omit<ModelPose, 'rect'> => ({
  rotationYDeg: kf.rotationYDeg,
  scale: kf.scale,
});

const staticPose = (op: OverlayModelOp): Omit<ModelPose, 'rect'> => ({
  rotationYDeg: op.params.rotationYDeg ?? 0,
  scale: op.params.scale ?? 1,
});

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/**
 * Pose at project-time t: static params, or linear interpolation over attached
 * keyframes (clamped to the first/last keyframe outside their span).
 */
export function resolveModelPoseAt(op: OverlayModelOp, t: number): Omit<ModelPose, 'rect'> {
  const kfs = (op as AnimatedOverlayModelOp).keyframes;
  if (!kfs || kfs.length === 0) return staticPose(op);
  const sorted = [...kfs].sort((a, b) => a.tSec - b.tSec);
  if (t <= sorted[0].tSec) return kfPose(sorted[0]);
  const last = sorted[sorted.length - 1];
  if (t >= last.tSec) return kfPose(last);
  let lo = sorted[0];
  let hi = last;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].tSec && t <= sorted[i + 1].tSec) {
      lo = sorted[i];
      hi = sorted[i + 1];
      break;
    }
  }
  const span = hi.tSec - lo.tSec;
  const k = span <= 0 ? 0 : (t - lo.tSec) / span;
  return {
    rotationYDeg: lerp(lo.rotationYDeg, hi.rotationYDeg, k),
    scale: lerp(lo.scale, hi.scale, k),
  };
}

/** Normalized position at t (static params, or keyframe interpolation). */
export function resolveModelPositionAt(
  op: OverlayModelOp,
  t: number
): { x: number; y: number } {
  const kfs = (op as AnimatedOverlayModelOp).keyframes;
  if (!kfs || kfs.length === 0) return op.params.position ?? { x: 0, y: 0 };
  const sorted = [...kfs].sort((a, b) => a.tSec - b.tSec);
  const at = (kf: ModelKeyframe) => kf.position;
  if (t <= sorted[0].tSec) return at(sorted[0]);
  const last = sorted[sorted.length - 1];
  if (t >= last.tSec) return at(last);
  let lo = sorted[0];
  let hi = last;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].tSec && t <= sorted[i + 1].tSec) {
      lo = sorted[i];
      hi = sorted[i + 1];
      break;
    }
  }
  const span = hi.tSec - lo.tSec;
  const k = span <= 0 ? 0 : (t - lo.tSec) / span;
  return {
    x: lerp(lo.position.x, hi.position.x, k),
    y: lerp(lo.position.y, hi.position.y, k),
  };
}

/** Pixel rect for compositing the model render onto a W×H frame. Shared by preview and export. */
export function modelDrawRect(
  op: OverlayModelOp,
  t: number,
  W: number,
  H: number
): { dx: number; dy: number; dw: number; dh: number } {
  const { scale } = resolveModelPoseAt(op, t);
  const { x, y } = resolveModelPositionAt(op, t);
  const size = Math.min(W, H) * 0.62 * clamp(scale, 0.05, 10);
  const cx = W / 2 + clamp(x, -1, 1) * (W / 2);
  const cy = H / 2 - clamp(y, -1, 1) * (H / 2);
  return { dx: cx - size / 2, dy: cy - size / 2, dw: size, dh: size };
}

/** Pose + rect in one call — what a renderer needs to draw the model at time t. */
export function resolveModelDrawAt(op: OverlayModelOp, t: number, W: number, H: number): ModelPose {
  return { rect: modelDrawRect(op, t, W, H), ...resolveModelPoseAt(op, t) };
}
