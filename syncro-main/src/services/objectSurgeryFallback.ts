// Gemini fallback leg for object surgery (provider unreachable or quality miss).
//
// Pinned against live docs, 2026-10-30: `gemini-2.5-flash-image` (Nano Banana)
// is the stable image-editing model on the Gemini API — called through
// @google/genai `models.generateContent` with `responseModalities: [IMAGE]`
// and inline image parts. Newer Nano Banana 2 generation ids
// (`gemini-3.1-flash-image` class) are the documented swap candidates: change
// GEMINI_IMAGE_EDIT_MODEL and nothing else.
//
// The fallback degrades on purpose: it edits ONE keyframe (removal or
// insertion). The pipeline renders the result as a held-frame segment and
// logs the degradation — the source footage outside the op window is never
// touched either way.

import { GoogleGenAI, Modality } from '@google/genai';
import { getApiKey } from './apiKey';
import { startLog, finishLog, type LogEntry } from './logger';

export const GEMINI_IMAGE_EDIT_MODEL = 'gemini-2.5-flash-image';

/** data URL → { mimeType, base64 } for inlineData parts. */
function splitDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Expected a base64 data URL');
  return { mimeType: match[1], data: match[2] };
}

function extractImage(log: LogEntry, response: unknown): string {
  const parts = (response as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> })
    .candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return `data:${part.inlineData.mimeType ?? 'image/png'};base64,${part.inlineData.data}`;
    }
  }
  finishLog(log, 'Model returned no image part');
  throw new Error('Gemini image edit returned no image');
}

async function editImage(log: LogEntry, prompt: string, images: string[]): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const response = await ai.models.generateContent({
    model: GEMINI_IMAGE_EDIT_MODEL,
    contents: [{
      role: 'user',
      parts: [
        ...images.map(dataUrl => {
          const { mimeType, data } = splitDataUrl(dataUrl);
          return { inlineData: { mimeType, data } };
        }),
        { text: prompt },
      ],
    }],
    config: { responseModalities: [Modality.IMAGE] },
  });
  return extractImage(log, response);
}

/**
 * Edits ONE keyframe: removes the object marked white in the mask image and
 * fills the area with a plausible continuation of the scene. Returns the
 * edited image as a data URL.
 */
export async function editImageRemoveObject(keyframeDataUrl: string, maskDataUrl: string, backgroundPrompt: string): Promise<string> {
  const log = startLog('Gemini fallback: remove object', GEMINI_IMAGE_EDIT_MODEL, backgroundPrompt);
  const edited = await editImage(
    log,
    `Edit the first image: remove the object marked white in the second image (a segmentation mask). ` +
    `Fill the removed area with ${backgroundPrompt}. Keep every pixel outside the mask unchanged. Return only the edited image.`,
    [keyframeDataUrl, maskDataUrl],
  );
  finishLog(log);
  return edited;
}

/**
 * Edits ONE keyframe: adds the described object into the scene, optionally
 * centered near a pixel coordinate of the provided image. Returns the edited
 * image as a data URL.
 */
export async function editImageInsertObject(keyframeDataUrl: string, description: string, point?: { x: number; y: number }): Promise<string> {
  const log = startLog('Gemini fallback: insert object', GEMINI_IMAGE_EDIT_MODEL, description);
  const at = point ? ` centered near pixel coordinates (${Math.round(point.x)}, ${Math.round(point.y)}) of the provided image` : '';
  const edited = await editImage(
    log,
    `Edit this image: add ${description}${at}. Match the scene's lighting, perspective, and visual style so the addition looks intentional. Return only the edited image.`,
    [keyframeDataUrl],
  );
  finishLog(log);
  return edited;
}
