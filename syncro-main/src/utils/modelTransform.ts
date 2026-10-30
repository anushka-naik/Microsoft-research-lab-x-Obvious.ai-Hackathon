// Pure transform state for 3D model overlays. Shared by the editor panel and
// (later) the overlay-model op pipeline, so clamping and defaults stay
// identical in both surfaces.

export type Vec3 = [number, number, number];

export interface ModelTransform {
  /** Offset on the model's local axes. */
  position: Vec3;
  /** Degrees, applied X then Y then Z. */
  rotationDeg: Vec3;
  /** Uniform scale factor. */
  scale: number;
}

export const DEFAULT_MODEL_TRANSFORM: ModelTransform = {
  position: [0, 0, 0],
  rotationDeg: [0, 0, 0],
  scale: 1,
};

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

// Non-finite input (NaN, Infinity, undefined from partial JSON) falls back.
const sane = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const vec3 = (raw: unknown, fallback: Vec3, min: number, max: number): Vec3 => {
  const arr = Array.isArray(raw) ? raw : [];
  return [0, 1, 2].map((i) =>
    clamp(sane(arr[i], fallback[i]), min, max)
  ) as Vec3;
};

/** Coerce partial or corrupt input into a fully valid, clamped transform. */
export function sanitizeTransform(
  raw: Partial<ModelTransform> | null | undefined
): ModelTransform {
  return {
    position: vec3(raw?.position, DEFAULT_MODEL_TRANSFORM.position, -10, 10),
    rotationDeg: vec3(raw?.rotationDeg, DEFAULT_MODEL_TRANSFORM.rotationDeg, -180, 180),
    scale: clamp(sane(raw?.scale, DEFAULT_MODEL_TRANSFORM.scale), 0.05, 10),
  };
}

/** Return a copy of `t` with `axis` replaced by `v`. */
export function setVec3At(t: Vec3, axis: 0 | 1 | 2, v: number): Vec3 {
  const out: Vec3 = [t[0], t[1], t[2]];
  out[axis] = v;
  return out;
}
