import { finishLog, startLog } from '../logger';
import { getTripoApiKey } from './apiKeys';
import { describeImage, GenerateOptions, ImageTo3DProvider, ImageTo3DResult, providerHttpError, sleep } from './base';

// Pinned against https://developers.tripo3d.ai/en/docs (retrieved 2026-10-30):
//   POST /v3/files                     multipart/form-data, JPEG/PNG ≤ 20 MB
//                                      → { code, data: { file_token } }
//   POST /v3/generation/image-to-model { input: <file_token | image URL>, model, texture }
//                                      → { code: 0, data: { task_id } }
//   GET  /v3/tasks/{task_id}           → { code, data: { status: queued | running | success |
//                                        failed | cancelled, progress, error_message,
//                                        output: { model_url } } }
// `input` also accepts a public image URL directly; captured frames are data URIs,
// so they go through the upload endpoint first. Docs warn unknown statuses can
// appear and must be treated as NON-terminal under a bounded wait.
const BASE = 'https://openapi.tripo3d.ai/v3';
export const TRIPO_MODEL = 'v3.1-20260211';

interface TripoResponse<T> { code?: number; message?: string; data?: T }

interface TripoTaskData {
  task_id?: string;
  status?: string;
  progress?: number;
  error_message?: string;
  output?: { model_url?: string; rendered_image_url?: string };
}

/** Unknown-status tolerance: docs say treat unknowns as non-terminal, but bounded. */
const MAX_UNKNOWN_POLLS = 20;

async function dataUrlToBlob(imageDataUrl: string): Promise<Blob> {
  const comma = imageDataUrl.indexOf(',');
  const meta = imageDataUrl.slice(0, comma);
  const colon = meta.indexOf(':');
  const semi = meta.indexOf(';');
  const mime = meta.slice(colon + 1, semi === -1 ? undefined : semi) || 'image/png';
  const binary = atob(imageDataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function unwrapTripoError(res: Response): Promise<never> {
  throw await providerHttpError('Tripo', res);
}

async function uploadFrame(imageDataUrl: string, apiKey: string): Promise<string> {
  const form = new FormData();
  form.append('file', await dataUrlToBlob(imageDataUrl), 'frame.png');
  const res = await fetch(`${BASE}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) await unwrapTripoError(res);
  const body: TripoResponse<{ file_token?: string; image_token?: string; token?: string }> =
    await res.json().catch(() => ({}));
  if (typeof body.code === 'number' && body.code !== 0) {
    throw new Error(`Tripo upload failed (code ${body.code}): ${body.message ?? 'no details'}`);
  }
  // Docs name `file_token`; older v2 pages used `image_token` — accept both.
  const token = body.data?.file_token ?? body.data?.image_token ?? body.data?.token;
  if (!token) throw new Error('Tripo upload response did not include a file token');
  return token;
}

async function createTask(input: string, apiKey: string): Promise<string> {
  const res = await fetch(`${BASE}/generation/image-to-model`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, model: TRIPO_MODEL, texture: true }),
  });
  if (!res.ok) await unwrapTripoError(res);
  const body: TripoResponse<{ task_id?: string }> = await res.json().catch(() => ({}));
  if (typeof body.code === 'number' && body.code !== 0) {
    throw new Error(`Tripo create failed (code ${body.code}): ${body.message ?? 'no details'}`);
  }
  const taskId = body.data?.task_id;
  if (!taskId) throw new Error('Tripo create response did not include a task id');
  return taskId;
}

async function pollUntilDone(
  taskId: string,
  apiKey: string,
  options: { pollMs: number; timeoutMs: number; onProgress?: (percent: number) => void },
): Promise<ImageTo3DResult> {
  const deadline = Date.now() + options.timeoutMs;
  let unknownPolls = 0;
  let lastProgress = -1;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) await unwrapTripoError(res);
    const body: TripoResponse<TripoTaskData> = await res.json().catch(() => ({}));
    if (typeof body.code === 'number' && body.code !== 0) {
      throw new Error(`Tripo query failed (code ${body.code}): ${body.message ?? 'no details'}`);
    }
    const task = body.data ?? {};
    if (typeof task.progress === 'number' && task.progress !== lastProgress) {
      lastProgress = task.progress;
      options.onProgress?.(task.progress);
    }
    switch (task.status) {
      case 'success': {
        const modelUrl = task.output?.model_url;
        if (!modelUrl) throw new Error('Tripo task succeeded but returned no model URL');
        return { provider: 'tripo', taskId, modelUrl, thumbnailUrl: task.output?.rendered_image_url };
      }
      case 'failed':
      case 'cancelled':
      case 'banned':
      case 'expired':
        throw new Error(`Tripo task ${task.status}: ${task.error_message?.trim() || 'no error details returned'}`);
      case 'queued':
      case 'running':
        unknownPolls = 0;
        await sleep(options.pollMs);
        break;
      default:
        // Unknown status — bounded non-terminal wait per Tripo docs.
        unknownPolls += 1;
        if (unknownPolls > MAX_UNKNOWN_POLLS) {
          throw new Error(`Tripo task ${taskId} kept reporting an unknown status "${task.status ?? 'none'}"`);
        }
        await sleep(options.pollMs);
    }
  }
  throw new Error(`Tripo task ${taskId} did not finish within ${Math.round(options.timeoutMs / 60_000)} min`);
}

export const tripoImageTo3D: ImageTo3DProvider = {
  id: 'tripo',
  label: 'Tripo',
  isConfigured: () => !!getTripoApiKey(),

  async generateFromImage(imageDataUrl: string, options: GenerateOptions = {}): Promise<ImageTo3DResult> {
    const { onProgress, pollMs = 3000, timeoutMs = 10 * 60_000 } = options;
    const apiKey = getTripoApiKey();
    if (!apiKey) throw new Error('No Tripo API key set. Click the key icon in the header to add one.');
    const log = startLog('Image → 3D', TRIPO_MODEL, describeImage(imageDataUrl));
    try {
      // Public URLs go straight through; local frames upload first.
      const input = imageDataUrl.startsWith('data:') ? await uploadFrame(imageDataUrl, apiKey) : imageDataUrl;
      const taskId = await createTask(input, apiKey);
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
