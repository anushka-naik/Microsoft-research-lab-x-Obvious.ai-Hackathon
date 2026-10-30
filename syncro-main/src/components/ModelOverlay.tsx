// Preview-side 2.5D model compositing. Uses the SAME offscreen renderer and the
// SAME pose resolver as the export loop, so what the preview shows is what the
// export renders.
import { useEffect, useRef, useState } from 'react';
import type { DrawOp, EditOp } from '../state/editOps';
import { resolveModelDrawAt } from '../utils/overlayModel';
import type { CompositorHandle } from './modelCompositor';

interface ModelOverlayProps {
  drawOps: DrawOp[];
  ops: EditOp[];
  currentTime: number;
}

export function ModelOverlay({ drawOps, ops, currentTime }: ModelOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositorRef = useRef<CompositorHandle | null>(null);
  const loadedUrlRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  const active = drawOps.filter((d): d is Extract<DrawOp, { kind: 'overlay-model' }> => d.kind === 'overlay-model');
  const wantedUrl = active[0]?.modelUrl ?? null;

  // Boot/swap the lazy compositor when a model is first needed or changes.
  useEffect(() => {
    if (!wantedUrl || loadedUrlRef.current === wantedUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const { createModelCompositor } = await import('./modelCompositor');
        if (cancelled) return;
        if (!compositorRef.current) compositorRef.current = await createModelCompositor();
        await compositorRef.current.loadModel(wantedUrl);
        if (cancelled) return;
        loadedUrlRef.current = wantedUrl;
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wantedUrl]);

  // Redraw on every timeline tick. Skipped while the model is still loading.
  useEffect(() => {
    const canvas = canvasRef.current;
    const compositor = compositorRef.current;
    if (!canvas || !compositor || !wantedUrl || loadedUrlRef.current !== wantedUrl) return;
    const W = (canvas.width = canvas.clientWidth || 640);
    const H = (canvas.height = canvas.clientHeight || 360);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    for (const d of active) {
      const op = ops.find((o) => o.id === d.opId);
      if (!op || op.type !== 'overlay-model') continue;
      const pose = resolveModelDrawAt(op, currentTime, W, H);
      compositor.renderAt(pose);
      ctx.drawImage(compositor.canvas, pose.rect.dx, pose.rect.dy, pose.rect.dw, pose.rect.dh);
    }
  });

  // Stays mounted (refs survive instruction gaps); hidden when nothing to draw.
  const visible = active.length > 0 && !failed;
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={visible ? undefined : { display: 'none' }}
    />
  );
}
