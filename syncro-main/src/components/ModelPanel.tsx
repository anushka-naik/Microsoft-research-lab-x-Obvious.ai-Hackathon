// 3D model editor surface. three.js itself lives in modelViewer.ts and loads
// through a dynamic import here, so the critical bundle never pays for it.
import { useEffect, useRef, useState } from 'react';
import { Box, Download, Loader2, Upload, X } from 'lucide-react';
import {
  DEFAULT_MODEL_TRANSFORM,
  sanitizeTransform,
  setVec3At,
  type ModelTransform,
  type Vec3,
} from '../utils/modelTransform';
import type { ViewerHandle } from './modelViewer';

interface ModelPanelProps {
  onClose: () => void;
  /** Provider-generated GLB to open automatically (op pipeline wires this later). */
  glbUrl?: string | null;
  glbName?: string;
}

const POS_RANGE = { min: -3, max: 3, step: 0.05 };
const ROT_RANGE = { min: -180, max: 180, step: 1 };
const SCALE_RANGE = { min: 0.1, max: 4, step: 0.05 };
const LIGHT_RANGE = { min: 0, max: 6, step: 0.1 };

const SLIDER_CLS = 'w-full accent-violet-500';
const LABEL_CLS = 'flex items-center justify-between text-xs text-gray-600 font-medium';

function AxisSlider({
  label,
  value,
  range,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className={LABEL_CLS}>
        <span>{label}</span>
        <span className="tabular-nums text-gray-400">
          {value.toFixed(2)}
          {unit ?? ''}
        </span>
      </div>
      <input
        type="range"
        className={SLIDER_CLS}
        {...range}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function ModelPanel({ onClose, glbUrl, glbName }: ModelPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<ViewerHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasModel, setHasModel] = useState(false);
  const [transform, setTransform] = useState<ModelTransform>(DEFAULT_MODEL_TRANSFORM);
  const [light, setLight] = useState(2.2);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(glbUrl ?? null);
  const [downloadName, setDownloadName] = useState(glbName ?? 'model.glb');

  // Boot the lazy viewer once on mount; dispose on close.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let handle: ViewerHandle | null = null;
    (async () => {
      try {
        const { createViewer } = await import('./modelViewer');
        if (disposed) return;
        handle = await createViewer(container);
        viewerRef.current = handle;
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to initialize the 3D viewer');
      }
    })();
    return () => {
      disposed = true;
      handle?.dispose();
      viewerRef.current = null;
    };
  }, []);

  // Push UI state into the scene.
  useEffect(() => {
    viewerRef.current?.setTransform(transform);
  }, [transform, ready]);
  useEffect(() => {
    viewerRef.current?.setLightIntensity(light);
  }, [light, ready]);

  const loadFromUrl = async (url: string, name: string) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    setLoading(true);
    setError(null);
    try {
      await viewer.loadGlbUrl(url);
      setTransform(DEFAULT_MODEL_TRANSFORM);
      viewer.setTransform(DEFAULT_MODEL_TRANSFORM);
      setHasModel(true);
      setDownloadUrl(url);
      setDownloadName(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load GLB');
      setHasModel(viewer.hasModel());
    } finally {
      setLoading(false);
    }
  };

  // Auto-open a provider-generated model when the panel opens with one.
  useEffect(() => {
    if (ready && glbUrl) void loadFromUrl(glbUrl, glbName ?? 'model.glb');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, glbUrl]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    void loadFromUrl(url, file.name.replace(/\.\w+$/, '') + '.glb');
  };

  const loadDemo = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.loadDemoMesh();
    viewer.setTransform(DEFAULT_MODEL_TRANSFORM);
    setTransform(DEFAULT_MODEL_TRANSFORM);
    setHasModel(true);
    setDownloadUrl(null);
    setError(null);
  };

  const setPos = (axis: 0 | 1 | 2, v: number) =>
    setTransform((t) => sanitizeTransform({ ...t, position: setVec3At(t.position, axis, v) }));
  const setRot = (axis: 0 | 1 | 2, v: number) =>
    setTransform((t) => sanitizeTransform({ ...t, rotationDeg: setVec3At(t.rotationDeg, axis, v) }));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Box className="w-4 h-4 text-violet-500" /> 3D Model Editor
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div
            ref={containerRef}
            className="relative h-[380px] rounded-lg overflow-hidden bg-gray-900"
          />

          {loading && (
            <p className="flex items-center gap-2 text-xs text-gray-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading model…
            </p>
          )}
          {error && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer">
              <Upload className="w-3 h-3" /> Load GLB file
              <input
                type="file"
                accept=".glb,model/gltf-binary"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
            <button
              onClick={loadDemo}
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
            >
              Load demo object
            </button>
            {downloadUrl && hasModel ? (
              <a
                href={downloadUrl}
                download={downloadName}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-violet-100 text-violet-600 hover:bg-violet-200"
              >
                <Download className="w-3 h-3" /> Download GLB
              </a>
            ) : (
              <span
                title="Load or generate a GLB to enable download"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-50 text-gray-300 cursor-not-allowed"
              >
                <Download className="w-3 h-3" /> Download GLB
              </span>
            )}
          </div>

          {hasModel && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 border-t border-gray-100 pt-4">
              <AxisSlider label="Position X" value={transform.position[0]} range={POS_RANGE} onChange={(v) => setPos(0, v)} />
              <AxisSlider label="Position Y" value={transform.position[1]} range={POS_RANGE} onChange={(v) => setPos(1, v)} />
              <AxisSlider label="Position Z" value={transform.position[2]} range={POS_RANGE} onChange={(v) => setPos(2, v)} />
              <AxisSlider label="Rotation X" value={transform.rotationDeg[0]} range={ROT_RANGE} unit="°" onChange={(v) => setRot(0, v)} />
              <AxisSlider label="Rotation Y" value={transform.rotationDeg[1]} range={ROT_RANGE} unit="°" onChange={(v) => setRot(1, v)} />
              <AxisSlider label="Rotation Z" value={transform.rotationDeg[2]} range={ROT_RANGE} unit="°" onChange={(v) => setRot(2, v)} />
              <AxisSlider label="Scale" value={transform.scale} range={SCALE_RANGE} onChange={(v) => setTransform((t) => sanitizeTransform({ ...t, scale: v }))} />
              <AxisSlider label="Key light" value={light} range={LIGHT_RANGE} onChange={setLight} />
              <div className="col-span-2 md:col-span-3 text-[11px] text-gray-400">
                Drag to orbit, scroll to zoom, right-drag to pan. Transform resets when a new model loads.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
