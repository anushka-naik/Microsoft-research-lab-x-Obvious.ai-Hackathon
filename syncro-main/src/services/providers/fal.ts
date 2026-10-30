// fal.ai provider clients for object surgery.
//
// Models pinned against live docs (fetched 2026-10-30):
//  - `fal-ai/sam2/image` — SAM2 segmentation with point prompts.
//    Input: image_url (data URIs accepted), prompts [{x, y, label}], output_format.
//    Output: { image: { url, width, height, ... } } — the mask rendered as a PNG.
//    https://fal.ai/models/fal-ai/sam2/image/api
//  - `fal-ai/void-video-inpainting` — ProPainter-class video object removal.
//    Input: video_url (required), quad_mask_video_url (binary mask video:
//    white = remove, black = keep) OR mask_prompt (SAM-3 auto masking),
//    prompt (required: desired background). Output: { video: { url } }.
//    https://fal.ai/models/fal-ai/void-video-inpainting/api
//
// REST queue API (https://fal.ai/docs/documentation/model-apis/inference/queue):
// submit → { request_id, status_url, response_url }; poll status_url until
// COMPLETED; fetch response_url for the result. Auth header: `Authorization: Key <FAL_KEY>`.

import { getProviderKey } from '../apiKey';
import type { InpaintInput, MaskResult, SegmentationClient, SegmentationPoint, VideoInpaintingClient } from './types';

export const FAL_SAM2_IMAGE = 'fal-ai/sam2/image';
export const FAL_VOID_VIDEO_INPAINTING = 'fal-ai/void-video-inpainting';

const FAL_QUEUE_BASE = 'https://queue.fal.run';
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

interface FalQueueSubmitResponse {
  request_id: string;
  status_url: string;
  response_url: string;
}

interface FalFile {
  url: string;
  content_type?: string;
  width?: number;
  height?: number;
}

/** Encode a blob as a base64 data URI — fal accepts data URIs for any file input. */
export function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to encode blob as data URI'));
    reader.readAsDataURL(blob);
  });
}

async function falQueueRequest<T>(url: string, apiKey: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`fal.ai request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/** Submit a queue request and poll until the result is ready. */
async function falQueueRun(modelId: string, input: Record<string, unknown>, apiKey: string): Promise<any> {
  const submitted = await falQueueRequest<FalQueueSubmitResponse>(`${FAL_QUEUE_BASE}/${modelId}`, apiKey, {
    method: 'POST',
    body: JSON.stringify(input),
  });

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const status = await falQueueRequest<{ status: string; error?: unknown }>(
      `${submitted.status_url}?logs=1`, apiKey);
    if (status.status === 'COMPLETED') {
      return falQueueRequest<any>(submitted.response_url, apiKey);
    }
    if (status.status !== 'IN_QUEUE' && status.status !== 'IN_PROGRESS') {
      throw new Error(`fal.ai job ${modelId} ended with status ${status.status}`);
    }
  }
  throw new Error(`fal.ai job ${modelId} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
}

// ── SAM2 image segmentation ──────────────────────────────────────────────────

export class FalSam2Segmenter implements SegmentationClient {
  readonly provider = 'fal' as const;
  readonly model = FAL_SAM2_IMAGE;

  async segmentImage(frameDataUrl: string, point: SegmentationPoint): Promise<MaskResult> {
    const apiKey = getProviderKey('fal');
    if (!apiKey) throw new Error('No fal.ai API key set. Click the key icon in the header to add one.');
    const result = await falQueueRun(FAL_SAM2_IMAGE, {
      image_url: frameDataUrl,
      prompts: [{ x: Math.round(point.x), y: Math.round(point.y), label: point.label ?? 1 }],
      output_format: 'png',
    }, apiKey);
    const image: FalFile | undefined = result?.image;
    if (!image?.url) throw new Error('fal.ai sam2/image returned no mask image');
    return { maskDataUrl: image.url };
  }
}

// ── VOID video inpainting (object removal) ──────────────────────────────────

export class FalVoidInpainter implements VideoInpaintingClient {
  readonly provider = 'fal' as const;
  readonly model = FAL_VOID_VIDEO_INPAINTING;

  async inpaintVideo(input: InpaintInput): Promise<string> {
    const apiKey = getProviderKey('fal');
    if (!apiKey) throw new Error('No fal.ai API key set. Click the key icon in the header to add one.');
    const payload: Record<string, unknown> = {
      video_url: await blobToDataUri(input.video),
      prompt: input.backgroundPrompt,
    };
    if (input.maskVideo) {
      payload.quad_mask_video_url = await blobToDataUri(input.maskVideo);
    } else if (input.maskPrompt) {
      payload.mask_prompt = input.maskPrompt;
    } else {
      throw new Error('VOID inpainting needs a mask video or a mask prompt');
    }

    const result = await falQueueRun(FAL_VOID_VIDEO_INPAINTING, payload, apiKey);
    const url: string | undefined = result?.video?.url;
    if (!url) throw new Error('fal.ai void-video-inpainting returned no video URL');
    return url;
  }
}
