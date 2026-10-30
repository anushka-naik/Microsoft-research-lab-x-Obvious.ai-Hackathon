import React, { useEffect, useState } from 'react';
import { X, Palette, Sparkles, Trash2, Loader2 } from 'lucide-react';
import type { VideoClip } from '../types';
import type { StyleBible } from '../state/editOps';
import { generateStyleBible } from '../services/gemini';
import { ConnectProviderCard, readProviderKeyStatus } from './ConnectProviderCard';
import { evaluateKeyGate, type KeyGateResult } from '../utils/providerGate';

// ═══════════════════════════════════════════════════════════════════════════
// Style Bible panel — generate the project look from a prompt (optionally
// grounded in a reference clip), fine-tune its grade values, and apply/clear.
// The applied Bible is the project-wide default every render path consumes.
// ═══════════════════════════════════════════════════════════════════════════

interface StyleBiblePanelProps {
  bible: StyleBible | null;
  videoClips: VideoClip[];
  onApply: (bible: StyleBible | null) => void;
  onClose: () => void;
}

function GradeSlider({
  label, value, min, max, step, onChange, format,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex justify-between">
        {label}
        <span className="font-mono text-zinc-500">{format ? format(value) : value.toFixed(2)}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-violet-500"
      />
    </label>
  );
}

export const StyleBiblePanel: React.FC<StyleBiblePanelProps> = ({ bible, videoClips, onApply, onClose }) => {
  const [prompt, setPrompt] = useState('');
  const [useReference, setUseReference] = useState(false);
  const [editing, setEditing] = useState<StyleBible | null>(bible);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyGate, setKeyGate] = useState<KeyGateResult | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleGenerate = async () => {
    // Paid feature: without a key, show the Connect-provider card instead of a dead error.
    const gate = evaluateKeyGate('style-bible', readProviderKeyStatus());
    if (!gate.ok) { setKeyGate(gate); return; }
    setKeyGate(null);
    setIsGenerating(true);
    setError(null);
    try {
      const reference = useReference ? videoClips[0]?.file : undefined;
      const result = await generateStyleBible(prompt, reference);
      setEditing(result);
    } catch (err: any) {
      setError(err?.message ?? 'Generation failed — try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const setGrade = (key: keyof StyleBible['grade'], v: number) =>
    setEditing(prev => prev ? { ...prev, grade: { ...prev.grade, [key]: v } } : prev);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-zinc-200">
        <div className="flex items-center justify-between px-6 py-4 border-b bg-zinc-50/60 sticky top-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-violet-100 rounded-xl flex items-center justify-center">
              <Palette className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-800">Style Bible</h2>
              <p className="text-[11px] text-zinc-400">One spec for preview and export</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-lg text-zinc-500 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Generate */}
          <div className="space-y-3">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder='Describe the look — e.g. "warm nostalgic film look, soft contrast, heavy vignette, gentle dissolves"…'
              rows={2}
              maxLength={300}
              className="w-full text-sm px-3 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 placeholder:text-zinc-400 text-zinc-700 resize-none"
            />
            {videoClips.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-zinc-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useReference}
                  onChange={e => setUseReference(e.target.checked)}
                  className="accent-violet-500"
                />
                Match this reference clip: <span className="font-medium text-zinc-700 truncate max-w-[200px]">{videoClips[0].name}</span>
              </label>
            )}
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-xl transition-colors shadow shadow-violet-200"
            >
              {isGenerating
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                : <><Sparkles className="w-3.5 h-3.5" /> Generate Style Bible</>}
            </button>
            {keyGate && (
              <ConnectProviderCard
                gate={keyGate}
                onResolved={() => void handleGenerate()}
                onDismiss={() => setKeyGate(null)}
              />
            )}
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          {/* Edit grade values */}
          {editing ? (
            <div className="space-y-3 border-t border-zinc-100 pt-4">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Grade</p>
              <GradeSlider label="Brightness" value={editing.grade.brightness} min={0.5} max={1.5} step={0.05} onChange={v => setGrade('brightness', v)} />
              <GradeSlider label="Contrast" value={editing.grade.contrast} min={0.5} max={1.5} step={0.05} onChange={v => setGrade('contrast', v)} />
              <GradeSlider label="Saturation" value={editing.grade.saturation} min={0} max={2} step={0.05} onChange={v => setGrade('saturation', v)} />
              <GradeSlider label="Temperature" value={editing.grade.temperature} min={-1} max={1} step={0.05} onChange={v => setGrade('temperature', v)} format={v => (v > 0 ? `+${v.toFixed(2)} warm` : v < 0 ? `${v.toFixed(2)} cool` : 'neutral')} />
              <GradeSlider label="Vignette" value={editing.grade.vignette} min={0} max={1} step={0.05} onChange={v => setGrade('vignette', v)} format={v => v.toFixed(2)} />
            </div>
          ) : (
            <p className="text-xs text-zinc-400 border-t border-zinc-100 pt-4">
              No Style Bible applied. Generate one from a prompt{videoClips.length > 0 ? ' or from a reference clip' : ''} to give the whole project a consistent look.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t bg-zinc-50/60">
          <button
            onClick={() => { setEditing(null); onApply(null); }}
            disabled={!bible}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-500 disabled:opacity-40 transition-colors font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { if (editing) onApply(editing); onClose(); }}
              disabled={!editing}
              className="px-5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl transition-colors shadow shadow-emerald-200"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
