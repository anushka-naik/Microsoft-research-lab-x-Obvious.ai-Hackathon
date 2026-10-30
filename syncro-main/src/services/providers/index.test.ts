import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockImageTo3DProvider, getPreferredImageTo3DProvider } from './index';
import { meshyImageTo3D, MESHY_MODEL } from './meshy';
import { tripoImageTo3D, TRIPO_MODEL } from './tripo';

const FRAME = 'data:image/jpeg;base64,AAAA';

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response> | Response;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

interface CapturedCall { url: string; init?: RequestInit }

function stubFetch(handler: FetchHandler): { calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }));
  return { calls };
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('provider selection', () => {
  it('prefers Meshy when both keys are set', () => {
    localStorage.setItem('syncro_meshy_api_key', 'meshy-key');
    localStorage.setItem('syncro_tripo_api_key', 'tripo-key');
    expect(getPreferredImageTo3DProvider().id).toBe('meshy');
  });

  it('falls back to Tripo when only a Tripo key is set', () => {
    localStorage.setItem('syncro_tripo_api_key', 'tripo-key');
    expect(getPreferredImageTo3DProvider().id).toBe('tripo');
  });

  it('throws a key-dialog hint when no provider key is set', () => {
    expect(() => getPreferredImageTo3DProvider()).toThrow(/No image-to-3D provider configured/);
  });
});

describe('meshy client', () => {
  it('creates a task with the pinned request shape and resolves the GLB on SUCCEEDED', async () => {
    localStorage.setItem('syncro_meshy_api_key', 'meshy-key');
    const { calls } = stubFetch(url => {
      if (url === 'https://api.meshy.ai/openapi/v1/image-to-3d') {
        return jsonResponse({ result: 'task-1' }, 202);
      }
      if (url === 'https://api.meshy.ai/openapi/v1/image-to-3d/task-1') {
        return jsonResponse({
          status: 'SUCCEEDED',
          progress: 100,
          model_urls: { glb: 'https://assets.meshy.ai/model.glb' },
          thumbnail_url: 'https://assets.meshy.ai/thumb.png',
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const progress: number[] = [];
    const result = await meshyImageTo3D.generateFromImage(FRAME, {
      pollMs: 1,
      onProgress: p => progress.push(p),
    });

    expect(result).toEqual({
      provider: 'meshy',
      taskId: 'task-1',
      modelUrl: 'https://assets.meshy.ai/model.glb',
      thumbnailUrl: 'https://assets.meshy.ai/thumb.png',
    });
    // Pinned create contract: data URI passthrough, current model, GLB only.
    const create = JSON.parse(String(calls[0].init?.body));
    expect(create.image_url).toBe(FRAME);
    expect(create.ai_model).toBe(MESHY_MODEL);
    expect(create.target_formats).toEqual(['glb']);
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer meshy-key' });
    expect(progress).toContain(100);
  });

  it("rejects with the provider's message when the task FAILs", async () => {
    localStorage.setItem('syncro_meshy_api_key', 'meshy-key');
    stubFetch(url => {
      if (url.endsWith('/image-to-3d')) return jsonResponse({ result: 'task-2' }, 202);
      return jsonResponse({ status: 'FAILED', task_error: { message: 'content blocked by moderation' } });
    });

    await expect(meshyImageTo3D.generateFromImage(FRAME, { pollMs: 1 }))
      .rejects.toThrow('Meshy task failed: content blocked by moderation');
  });

  it('maps HTTP 401 to an actionable key error', async () => {
    localStorage.setItem('syncro_meshy_api_key', 'meshy-key');
    stubFetch(() => jsonResponse({ error: 'bad key' }, 401));

    await expect(meshyImageTo3D.generateFromImage(FRAME, { pollMs: 1 }))
      .rejects.toThrow('Meshy request failed (HTTP 401) — API key missing or invalid');
  });

  it('rejects up front when no key is configured', async () => {
    await expect(meshyImageTo3D.generateFromImage(FRAME)).rejects.toThrow(/No Meshy API key/);
  });
});

describe('tripo client', () => {
  it('uploads the frame, creates the pinned task, and resolves output.model_url', async () => {
    localStorage.setItem('syncro_tripo_api_key', 'tripo-key');
    const { calls } = stubFetch(url => {
      if (url === 'https://openapi.tripo3d.ai/v3/files') {
        return jsonResponse({ code: 0, data: { file_token: 'file_1' } });
      }
      if (url === 'https://openapi.tripo3d.ai/v3/generation/image-to-model') {
        return jsonResponse({ code: 0, data: { task_id: 't-9' } });
      }
      if (url === 'https://openapi.tripo3d.ai/v3/tasks/t-9') {
        return jsonResponse({
          code: 0,
          data: { status: 'success', progress: 100, output: { model_url: 'https://cdn.tripo3d.ai/m.glb' } },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const result = await tripoImageTo3D.generateFromImage(FRAME, { pollMs: 1 });

    expect(result).toMatchObject({ provider: 'tripo', taskId: 't-9', modelUrl: 'https://cdn.tripo3d.ai/m.glb' });
    const create = JSON.parse(String(calls[1].init?.body));
    expect(create.input).toBe('file_1');
    expect(create.model).toBe(TRIPO_MODEL);
  });

  it('rejects with the task error message on failure', async () => {
    localStorage.setItem('syncro_tripo_api_key', 'tripo-key');
    stubFetch(url => {
      if (url.endsWith('/v3/files')) return jsonResponse({ code: 0, data: { file_token: 'file_1' } });
      if (url.endsWith('/generation/image-to-model')) return jsonResponse({ code: 0, data: { task_id: 't-9' } });
      return jsonResponse({ code: 0, data: { status: 'failed', error_message: 'quota exceeded' } });
    });

    await expect(tripoImageTo3D.generateFromImage(FRAME, { pollMs: 1 }))
      .rejects.toThrow('Tripo task failed: quota exceeded');
  });

  it('treats unknown statuses as non-terminal only within a bounded wait', async () => {
    localStorage.setItem('syncro_tripo_api_key', 'tripo-key');
    stubFetch(url => {
      if (url.endsWith('/v3/files')) return jsonResponse({ code: 0, data: { file_token: 'file_1' } });
      if (url.endsWith('/generation/image-to-model')) return jsonResponse({ code: 0, data: { task_id: 't-9' } });
      return jsonResponse({ code: 0, data: { status: 'something-new', progress: 7 } });
    });

    await expect(tripoImageTo3D.generateFromImage(FRAME, { pollMs: 1, timeoutMs: 60_000 }))
      .rejects.toThrow(/unknown status "something-new"/);
  });
});

describe('mock provider', () => {
  it('returns the sample GLB without network and reports progress', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const mock = createMockImageTo3DProvider('https://example.com/Duck.glb', 4);
    const progress: number[] = [];
    const result = await mock.generateFromImage(FRAME, { onProgress: p => progress.push(p) });

    expect(result.provider).toBe('mock');
    expect(result.modelUrl).toBe('https://example.com/Duck.glb');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(progress).toEqual([25, 50, 75, 100]);
  });
});
