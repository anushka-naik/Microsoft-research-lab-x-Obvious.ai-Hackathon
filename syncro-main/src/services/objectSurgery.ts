// Object surgery pipeline — turns an object-remove / object-insert op into a
// pre-rendered replacement segment for exactly the op's window.
//
// The contract with the export/preview renderers: runObject* resolves to a
// blob URL stored in op.resultUrl; resolveSegmentSplice then swaps that
// segment in for [inSec, outSec) and plays the untouched source outside it.
// Only the subclip inside the op bounds is ever regenerated or uploaded —
// footage immediately before and after the window stays byte-comparable to
// the source, which is what keeps the splice clean.
//
// Primary path (removal): fal.ai SAM2 click-point segmentation + VOID video
// inpainting (ProPainter-class — real frames preserved outside the mask, so no
// texture drift). Fallback (provider unreachable / quality miss): Gemini
// image-edit of one keyframe rendered as a held-frame segment, with the
// degradation surfaced in the LogPanel — never a silent no-op.

import type { ObjectInsertOp, ObjectRemoveOp } from '../state/editOps';
import type { VideoClip } from '../types';
import { captureVideoFrame } from '../utils/exportUtils';
import { getSegmenter, getVideoInpainter, type SegmentationPoint } from './providers';
import { editImageInsertObject, editImageRemoveObject } from './objectSurgeryFallback';
import { startLog, finishLog } from './logger';

export const DEFAULT_BACKGROUND_PROMPT =
  'a clean, plausible continuation of the same scene, with the object seamlessly removed and the background behind it filled in realistically';

/** How the replacement segment was produced — surfaced through the LogPanel. */
export type SurgeryMode = 'inpaint' | 'held-frame-fallback' | 'held-frame-insert';

export interface SurgeryResult {
  /** Blob URL for the pre-rendered replacement segment (op.resultUrl). */
  resultUrl: string;
  mode: SurgeryMode;
}

/** Maps a project-timeline window onto the clip's source-file seconds. Pure. */
export function sourceTimeRange(clip: VideoClip, inSec: number, outSec: number): { srcStart: number; srcEnd: number } {
  const trimStart = clip.trimStart ?? 0;
  const srcStart = inSec - clip.startTime + trimStart;
  const srcEnd = outSec - clip.startTime + trimStart;
  if (srcEnd - srcStart <= 0) {
    throw new Error(`Invalid op window [${inSec}s, ${outSec}s) for clip "${clip.name}"`);
  }
  return { srcStart: Math.max(0, srcStart), srcEnd };
}

export function opDuration(inSec: number, outSec: number): number {
  return outSec - inSec;
}

/** MediaRecorder mimeType the current browser actually supports. */
function recorderMime(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
}

/**
 * Records `durationSec` of a canvas while `drawFrame` paints it each rAF.
 * Real-time capture (canvas.captureStream + MediaRecorder) — the same
 * mechanism the export loop uses, so segment framing matches export framing.
 * drawFrame receives the recording canvas's 2D context and paints directly.
 */
function recordCanvas(
  drawFrame: (ctx: CanvasRenderingContext2D, elapsedSec: number) => void,
  durationSec: number,
  width: number,
  height: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { reject(new Error('Canvas 2D unavailable')); return; }

    const stream = canvas.captureStream(30);
    const mime = recorderMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onerror = () => reject(new Error('Segment recording failed'));
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      resolve(new Blob(chunks, { type: mime || 'video/webm' }));
    };

    const startedAt = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      if (elapsed >= durationSec) { recorder.stop(); return; }
      drawFrame(ctx, elapsed);
      requestAnimationFrame(tick);
    };

    drawFrame(ctx, 0); // first frame valid before the recorder starts
    recorder.start();
    requestAnimationFrame(tick);
  });
}

/** Loads the clip's video element, seeks to a source-file second, and keeps it loaded for drawing. */
function loadVideoAt(clip: VideoClip, srcTime: number): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = clip.url;
    video.muted = true;
    video.preload = 'auto';
    video.onseeked = () => resolve(video);
    video.onerror = () => reject(new Error(`Could not load "${clip.name}" for segment cutting`));
    video.onloadedmetadata = () => { video.currentTime = srcTime; };
    video.load();
  });
}

/**
 * Cuts [srcStart, srcEnd) out of the clip: the video plays in real time while
 * each frame is painted onto the recording canvas. The result is a standalone
 * webm of exactly the op's window.
 */
export async function cutSubclip(clip: VideoClip, srcStart: number, srcEnd: number): Promise<Blob> {
  const video = await loadVideoAt(clip, srcStart);
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error(`Could not read dimensions of "${clip.name}"`);

  // The draw callback paints the video's current frame each tick — the video must
  // actually play, or recordCanvas captures one seeked frame for the whole window.
  try {
    await video.play();
  } catch (err) {
    video.pause();
    throw new Error(`Could not play "${clip.name}" for segment cutting: ${String(err)}`);
  }
  try {
    return await recordCanvas(
      ctx => { ctx.drawImage(video, 0, 0, width, height); },
      srcEnd - srcStart,
      width,
      height,
    );
  } finally {
    video.pause();
  }
}

/** Normalizes a mask image to pure black/white pixels (SAM2 output safety). */
async function normalizedMask(maskDataUrl: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Mask image failed to load'));
    img.src = maskDataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < data.data.length; i += 4) {
    const on = data.data[i] > 127; // red channel decides; output is binary
    data.data[i] = on ? 255 : 0;
    data.data[i + 1] = on ? 255 : 0;
    data.data[i + 2] = on ? 255 : 0;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

/** Renders the binary mask as a video matching the subclip's duration. */
export async function buildMaskVideo(maskDataUrl: string, durationSec: number, width: number, height: number): Promise<Blob> {
  const mask = await normalizedMask(maskDataUrl, width, height);
  return recordCanvas(
    ctx => { ctx.drawImage(mask, 0, 0, width, height); },
    durationSec,
    width,
    height,
  );
}

/** Held-frame segment: one edited keyframe kept on screen for the window. */
export async function heldFrameSegment(frameDataUrl: string, durationSec: number, width: number, height: number): Promise<Blob> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Edited frame failed to load'));
    img.src = frameDataUrl;
  });
  return recordCanvas(
    ctx => { ctx.drawImage(img, 0, 0, width, height); },
    durationSec,
    width,
    height,
  );
}

function blobUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/** Op mask, or a SAM2 click-point segmentation of the keyframe. */
async function resolveMask(clip: VideoClip, op: ObjectRemoveOp, srcStart: number): Promise<string> {
  if (op.params.maskDataUrl) return op.params.maskDataUrl;
  if (!op.params.point) throw new Error('Object-remove op has neither a mask nor a click point');
  const keyframe = await captureVideoFrame(clip, srcStart);
  const segmenter = getSegmenter();
  const point: SegmentationPoint = { x: op.params.point.x, y: op.params.point.y, label: 1 };
  const { maskDataUrl } = await segmenter.segmentImage(keyframe, point);
  return maskDataUrl;
}

/**
 * Runs an object-remove op end to end: subclip cut at the op bounds →
 * VOID video inpainting with the mask video → pre-rendered webm blob URL.
 * When inpainting fails (provider unreachable, quality miss), degrades to a
 * Gemini-edited held-frame segment and logs the degradation. Source footage
 * is never mutated; on total failure the op stays draft and the source
 * keeps playing through.
 */
export async function runObjectRemove(clip: VideoClip, op: ObjectRemoveOp): Promise<SurgeryResult> {
  const { srcStart, srcEnd } = sourceTimeRange(clip, op.inSec, op.outSec);
  const duration = opDuration(op.inSec, op.outSec);
  const backgroundPrompt = op.params.backgroundPrompt ?? DEFAULT_BACKGROUND_PROMPT;
  const log = startLog('Object remove', 'fal-ai/void-video-inpainting', `"${clip.name}" [${op.inSec}s → ${op.outSec}s]`);
  let logClosed = false;

  try {
    const probe = await loadVideoAt(clip, srcStart);
    const width = probe.videoWidth;
    const height = probe.videoHeight;
    if (!width || !height) throw new Error(`Could not read dimensions of "${clip.name}"`);
    const maskDataUrl = await resolveMask(clip, op, srcStart);

    try {
      const [subclip, maskVideo] = await Promise.all([
        cutSubclip(clip, srcStart, srcEnd),
        buildMaskVideo(maskDataUrl, duration, width, height),
      ]);
      const inpainter = getVideoInpainter();
      const hostedUrl = await inpainter.inpaintVideo({ video: subclip, maskVideo, backgroundPrompt });
      const stored = await fetch(hostedUrl);
      if (!stored.ok) throw new Error(`Segment download failed (${stored.status})`);
      const blob = await stored.blob();
      finishLog(log);
      logClosed = true;
      return { resultUrl: blobUrl(blob), mode: 'inpaint' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Degrade to the Gemini held-frame fallback; surface both the failure
      // reason and the degradation in the LogPanel.
      finishLog(log, `Inpainting failed: ${reason} — falling back to Gemini held-frame segment`);
      logClosed = true;
      const fallbackLog = startLog('Object remove (degraded)', 'gemini-2.5-flash-image', 'held-frame fallback');
      try {
        const keyframe = await captureVideoFrame(clip, srcStart);
        const edited = await editImageRemoveObject(keyframe, maskDataUrl, backgroundPrompt);
        const blob = await heldFrameSegment(edited, duration, width, height);
        finishLog(fallbackLog);
        return { resultUrl: blobUrl(blob), mode: 'held-frame-fallback' };
      } catch (fallbackErr) {
        finishLog(fallbackLog, fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr));
        throw fallbackErr;
      }
    }
  } catch (err) {
    if (!logClosed) {
      finishLog(log, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

/**
 * Runs an object-insert op: Gemini edits the keyframe to add the described
 * object, the edited frame is rendered as a held-frame segment for the window
 * (v1: static insert — keyframed position paths land with the UI panel).
 * Source footage is never mutated; on failure the op stays draft.
 */
export async function runObjectInsert(clip: VideoClip, op: ObjectInsertOp): Promise<SurgeryResult> {
  const { srcStart } = sourceTimeRange(clip, op.inSec, op.outSec);
  const duration = opDuration(op.inSec, op.outSec);
  const log = startLog('Object insert', 'gemini-2.5-flash-image', `"${clip.name}" [${op.inSec}s → ${op.outSec}s]: ${op.params.description}`);

  try {
    const keyframe = await captureVideoFrame(clip, srcStart);
    const probe = await loadVideoAt(clip, srcStart);
    const width = probe.videoWidth;
    const height = probe.videoHeight;
    if (!width || !height) throw new Error(`Could not read dimensions of "${clip.name}"`);
    const edited = await editImageInsertObject(keyframe, op.params.description, op.params.point);
    const blob = await heldFrameSegment(edited, duration, width, height);
    finishLog(log);
    return { resultUrl: blobUrl(blob), mode: 'held-frame-insert' };
  } catch (err) {
    finishLog(log, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
