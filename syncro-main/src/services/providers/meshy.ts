import { finishLog, startLog } from '../logger';
import { getMeshyApiKey } from './apiKeys';
import { describeImage, GenerateOptions, ImageTo3DProvider, ImageTo3DResult, providerHttpError, sleep } from './base';

// Pinned against https://docs.meshy.ai/en/api/image-to-3d (retrieved 2026-10-30):
//   POST /openapi/v1/image-to-3d      → 202 { result: "<task id>" }
//   GET  /openapi/v1/image-to-3d/{id} → { status: PENDING | IN_PROGRESS | SUCCEEDED | FAILED | CANCELED,
//       progress: 0–100, model_urls.glb, thumbnail_url, task_error: { message } }
// `image_url` accepts a base64 data URI (JPG/PNG/WebP ≤ 20 MB), so captured video
// frames go up without a separate hosting step.
const BASE = 'https://api.meshy.ai/openapi/v1/image-to-3d';
export const MESHY_MODEL = 'meshy-7.1';

interface MeshyTask {
  status?: string;
  progress?: number;
  model_urls?: { glb?: string };
  thumbnail_url?: string;
  task_error?: { message?: string };
}

async function createTask(imageDataUrl: string, apiKey: string): Promise<string> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: imageDataUrl,
      ai_model: MESHY_MODEL,
      should_texture: true,
      target_formats: ['glb'],
    }),
  });
  if (!res.ok) throw await providerHttpError('Meshy', res);
  const body: { result?: string } = await res.json().catch(() => ({}));
  if (typeof body.result !== 'string' || !body.result) {
    throw new Error('Meshy create response did not include a task id');
  }
  return body.result;
}

async function pollUntilDone(
  taskId: string,
  apiKey: string,
  options: { pollMs: number; timeoutMs: number; onProgress?: (percent: number) => void },
): Promise<ImageTo3DResult> {
  const deadline = Date.now() + options.timeoutMs;
  let lastProgress = -1;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/${taskId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw await providerHttpError('Meshy', res);
    const task: MeshyTask = await res.json().catch(() => ({}));
    if (typeof task.progress === 'number' && task.progress !== lastProgress) {
      lastProgress = task.progress;
      options.onProgress?.(task.progress);
    }
    switch (task.status) {
      case 'SUCCEEDED': {
        const glb = task.model_urls?.glb;
        if (!glb) throw new Error('Meshy task succeeded but returned no GLB URL');
        return { provider: 'meshy', taskId, modelUrl: glb, thumbnailUrl: task.thumbnail_url };
      }
      case 'FAILED':
      case 'CANCELED':
        throw new Error(`Meshy task ${task.status.toLowerCase()}: ${task.task_error?.message?.trim() || 'no error details returned'}`);
      default:
        // PENDING / IN_PROGRESS — keep polling until the deadline.
        await sleep(options.pollMs);
    }
  }
  throw new Error(`Meshy task ${taskId} did not finish within ${Math.round(options.timeoutMs / 60_000)} min`);
}

export const meshyImageTo3D: ImageTo3DProvider = {
  id: 'meshy',
  label: 'Meshy',
  isConfigured: () => !!getMeshyApiKey(),

  async generateFromImage(imageDataUrl: string, options: GenerateOptions = {}): Promise<ImageTo3DResult> {
    const { onProgress, pollMs = 3000, timeoutMs = 10 * 60_000 } = options;
    const apiKey = getMeshyApiKey();
    if (!apiKey) throw new Error('No Meshy API key set. Click the key icon in the header to add one.');
    const log = startLog('Image → 3D', MESHY_MODEL, describeImage(imageDataUrl));
    try {
      const taskId = await createTask(imageDataUrl, apiKey);
      const result = await pollUntilDone(taskId, apiKey, { pollMs, timeoutMs, onProgress });
      finishLog(log);
      return result;
    } catch (err) {
      // Surface the outage in the LogPanel AND rethrow — never a silent no-op.
      finishLog(log, err instanceof Error ? err.message : String(err));
      throw err;
    }
  },
};
