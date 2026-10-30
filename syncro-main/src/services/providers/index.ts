import { meshyImageTo3D } from './meshy';
import { tripoImageTo3D } from './tripo';
import { sleep } from './base';
import { GenerateOptions, ImageTo3DProvider, ImageTo3DResult, ProviderId } from './base';

export type { GenerateOptions, ImageTo3DProvider, ImageTo3DResult, ProviderId } from './base';
export { MESHY_MODEL } from './meshy';
export { TRIPO_MODEL } from './tripo';

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
