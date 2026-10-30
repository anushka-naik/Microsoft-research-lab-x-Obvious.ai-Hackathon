// Provider contract for image-to-3D behind ONE interface (spec art_2D8Tfgm1):
// every client implements ImageTo3DProvider; swapping a model or vendor is a
// registry change in index.ts, not a rewrite of callers.

export type ProviderId = 'meshy' | 'tripo' | 'mock';

export interface ImageTo3DResult {
  provider: ProviderId;
  taskId: string;
  /** URL of the generated GLB model. */
  modelUrl: string;
  thumbnailUrl?: string;
}

export interface GenerateOptions {
  /** Called with 0–100 when the provider reports task progress. */
  onProgress?: (percent: number) => void;
  /** Poll interval override in ms — tests pass 1 to keep them fast. */
  pollMs?: number;
  /** Overall deadline in ms. Default 10 min per provider task. */
  timeoutMs?: number;
}

export interface ImageTo3DProvider {
  id: ProviderId;
  label: string;
  isConfigured(): boolean;
  /**
   * Generate a GLB from a frame (JPEG/PNG data URL, or a public image URL for
   * real providers). Rejects on outage or provider failure — callers log it and
   * the LogPanel shows it. A provider outage is NEVER a silent no-op.
   */
  generateFromImage(imageDataUrl: string, options?: GenerateOptions): Promise<ImageTo3DResult>;
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Uniform HTTP error carrying provider, status, and actionable hints for known codes. */
export async function providerHttpError(provider: string, res: Response): Promise<Error> {
  const detail = await res.text().catch(() => '');
  const hints: Record<number, string> = {
    401: ' — API key missing or invalid',
    402: ' — out of credits (providers require a paid plan to create tasks)',
    404: ' — task not found',
    429: ' — rate limited; retry shortly',
  };
  const hint = hints[res.status] ?? '';
  const body = detail ? `: ${detail.slice(0, 300)}` : '';
  return new Error(`${provider} request failed (HTTP ${res.status})${hint}${body}`);
}

/** Short human-readable description of the input image for log entries. */
export function describeImage(imageDataUrl: string): string {
  const comma = imageDataUrl.indexOf(',');
  if (!imageDataUrl.startsWith('data:') || comma === -1) {
    const tail = imageDataUrl.slice(-40);
    return `image URL …${tail}`;
  }
  const meta = imageDataUrl.slice(0, comma);
  const semi = meta.indexOf(';');
  const mime = meta.slice(meta.indexOf(':') + 1, semi === -1 ? undefined : semi);
  const approxKb = Math.max(1, Math.round(((imageDataUrl.length - comma - 1) * 3) / 4 / 1024));
  return `frame ${mime || 'image'}, ~${approxKb} KB`;
}
