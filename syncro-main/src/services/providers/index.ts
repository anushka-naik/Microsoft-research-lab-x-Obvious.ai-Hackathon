// Provider registry — the single seam where a model swap is a config change.
//
// Two capability families share this directory, each with its own contract
// module (the unions differ, so `ProviderId` is intentionally NOT re-exported
// from both):
//   • Object surgery (this file's surgery getters): fal.ai serves both legs —
//     `fal-ai/sam2/image` for click-point segmentation and
//     `fal-ai/void-video-inpainting` (ProPainter-class video inpainting, SAM-3
//     auto-masking supported) for the segment regeneration. One fal key covers
//     the whole path and its queue API is browser-callable. Pinned against
//     live docs, 2026-10-30.
//   • Image-to-3D (IMAGE_TO_3D_PROVIDERS): Meshy preferred, Tripo fallback.
//
// Designated alternate for surgery: Replicate `jd7h/propainter` (mode
// `video_inpainting`, inputs `video` + `mask` mask-video,
// `Authorization: Bearer <token>`; community model — predictions pin a version
// hash, and browser CORS is unverified). To swap, implement
// `VideoInpaintingClient` for Replicate and register it in getVideoInpainter;
// the pipeline is untouched.

import { hasProviderKey } from '../apiKey';
import { FalSam2Segmenter, FalVoidInpainter } from './fal';
import type { SegmentationClient, VideoInpaintingClient } from './types';
import { meshyImageTo3D } from './meshy';
import { tripoImageTo3D } from './tripo';
import { sleep } from './base';
import { GenerateOptions, ImageTo3DProvider, ImageTo3DResult } from './base';

export const REPLICATE_PROPAINTER = 'jd7h/propainter';

// ── Object surgery (segmentation + video inpainting) ─────────────────────────

/** Fal.ai-only today; Replicate propainter is the documented alternate (see header). */
export function getSegmenter(): SegmentationClient {
  if (!hasProviderKey('fal')) {
    throw new Error('No fal.ai API key set. Click the key icon in the header to add one.');
  }
  return new FalSam2Segmenter();
}

export function getVideoInpainter(): VideoInpaintingClient {
  if (!hasProviderKey('fal')) {
    throw new Error('No fal.ai API key set. Click the key icon in the header to add one.');
  }
  return new FalVoidInpainter();
}

// ── Image-to-3D (best first: Meshy preferred, Tripo fallback) ────────────────

/**
 * Image-to-3D providers, best first (spec: Meshy preferred, Tripo-class fallback).
 * Adding or swapping a provider = edit this array. Callers never import a
 * concrete client.
 */
export const IMAGE_TO_3D_PROVIDERS: readonly ImageTo3DProvider[] = [meshyImageTo3D, tripoImageTo3D];

/** The first configured provider in preference order. Throws when no key is set. */
export function getPreferredImageTo3DProvider(): ImageTo3DProvider {
  const configured = IMAGE_TO_3D_PROVIDERS.filter(p => p.isConfigured());
  if (configured.length === 0) {
    throw new Error('No image-to-3D provider configured. Add a Meshy or Tripo API key via the key dialog in the header.');
  }
  return configured[0];
}

/** Preferred-provider facade — the one call site the UI and ops pipeline use. */
export async function generateModelFromImage(
  imageDataUrl: string,
  options?: GenerateOptions,
): Promise<ImageTo3DResult> {
  return getPreferredImageTo3DProvider().generateFromImage(imageDataUrl, options);
}

/**
 * Keyless mock for dogfooding and QA (the pipeline and compositing must stay
 * verifiable when no provider key is configured). Resolves to a deterministic
 * sample GLB after a short configurable delay, faking provider progress.
 */
export function createMockImageTo3DProvider(sampleModelUrl: string, delayMs = 1200): ImageTo3DProvider {
  return {
    id: 'mock',
    label: 'Mock (sample model)',
    isConfigured: () => true,
    async generateFromImage(_imageDataUrl: string, options: GenerateOptions = {}): Promise<ImageTo3DResult> {
      const steps = 4;
      for (let step = 1; step <= steps; step += 1) {
        await sleep(delayMs / steps);
        options.onProgress?.(Math.round((step / steps) * 100));
      }
      return {
        provider: 'mock',
        taskId: `mock-${Date.now().toString(36)}`,
        modelUrl: sampleModelUrl,
      };
    },
  };
}

// ── Public type surface ──────────────────────────────────────────────────────
// Surgery contracts (ProviderId stays module-internal to './types' here to
// avoid colliding with the image-to-3D union of the same name).
export type { SegmentationClient, VideoInpaintingClient, SegmentationPoint, MaskResult, InpaintInput } from './types';
// Image-to-3D contracts.
export type { GenerateOptions, ImageTo3DProvider, ImageTo3DResult, ProviderId } from './base';
export { MESHY_MODEL } from './meshy';
export { TRIPO_MODEL } from './tripo';
export { blobToDataUri } from './fal';
