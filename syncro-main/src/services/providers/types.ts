// Provider contracts for object surgery (segmentation + video inpainting).
//
// Each capability is a small interface so a model swap is a config change in
// the registry (index.ts), not a rewrite of the pipeline. Implementations live
// beside this file per platform (fal.ts today; Replicate's jd7h/propainter is
// the documented inpainting alternate).

export type ProviderId = 'gemini' | 'fal' | 'replicate';

/** A click point on a keyframe, in PIXELS of the provided frame image. `label` follows SAM semantics: 1 = include, 0 = exclude. */
export interface SegmentationPoint {
  x: number;
  y: number;
  label?: 0 | 1;
}

export interface MaskResult {
  /** PNG image of the segmentation (white = the clicked object, black = background). */
  maskDataUrl: string;
}

/** Segments one frame of footage. Implementations must not mutate the frame. */
export interface SegmentationClient {
  readonly provider: ProviderId;
  /** Pinned model id, e.g. `fal-ai/sam2/image`. */
  readonly model: string;
  segmentImage(frameDataUrl: string, point: SegmentationPoint): Promise<MaskResult>;
}

export interface InpaintInput {
  /** The isolated subclip to regenerate (a webm/mp4 blob cut at the op bounds). Untouched footage is never sent. */
  video: Blob;
  /** Binary mask video (white = object to remove, black = background) over the subclip's duration. Optional when the provider derives masks from `maskPrompt`. */
  maskVideo?: Blob;
  /** Text description of the object to remove — used for provider-side mask generation when `maskVideo` is absent. */
  maskPrompt?: string;
  /** Text description of the desired background after removal. */
  backgroundPrompt: string;
}

export interface VideoInpaintingClient {
  readonly provider: ProviderId;
  /** Pinned model id, e.g. `fal-ai/void-video-inpainting`. */
  readonly model: string;
  /** Regenerates the subclip with the object removed. Resolves to a hosted video URL of the replacement segment. */
  inpaintVideo(input: InpaintInput): Promise<string>;
}
