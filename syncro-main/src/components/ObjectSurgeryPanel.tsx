// Object surgery panel — the UI half of object-remove / object-insert ops.
//
// Flow: extract the frame at the playhead (captureVideoFrame) → pick the
// object with a click (remove) or describe it (insert) → set the in/out range
// → run. The op enters the journal as a draft (never rendered while
// generating), the pipeline pre-renders the replacement segment, and on
// success the op turns applied with a resultUrl — the preview's segment layer
// takes over inside [inSec, outSec) when the A/B toggle is on "Segment".
// Rejecting an op removes it from the journal, restoring source playback
// exactly. Failures land in the LogPanel via the pipeline's logger and inline.

import React, { useState } from 'react';
import { X, Eraser, Sparkles, Loader2, Trash2, Scan } from 'lucide-react';
import {
  EditOp,
  EditorAction,
  clipActiveWindow,
  createObjectInsertOp,
  createObjectRemoveOp,
} from '../state/editOps';
import { VideoClip } from '../types';
import { captureVideoFrame } from '../utils/exportUtils';
import { runObjectInsert, runObjectRemove, type SurgeryResult } from '../services/objectSurgery';
import { ConnectProviderCard, readProviderKeyStatus } from './ConnectProviderCard';
import { evaluateKeyGate, type KeyGateResult } from '../utils/providerGate';

type Mode = 'remove' | 'insert';

interface ObjectSurgeryPanelProps {
  /** Clip active at the playhead (already trim-resolved). */
  clip: VideoClip | null;
  /** Seconds into the clip's source file the playhead sits at. */
  sourceOffset: number;
  /** Project-timeline instant — the default range start. */
  currentTime: number;
  ops: EditOp[];
  dispatch: React.Dispatch<EditorAction>;
  abMode: 'source' | 'segment';
  onAbModeChange: (mode: 'source' | 'segment') => void;
  onClose: () => void;
}

export const ObjectSurgeryPanel: React.FC<ObjectSurgeryPanelProps> = ({
  clip,
  sourceOffset,
  currentTime,
  ops,
  dispatch,
  abMode,
  onAbModeChange,
  onClose,
}) => {
  const [mode, setMode] = useState<Mode>('remove');
  const [keyframe, setKeyframe] = useState<string | null>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [description, setDescription] = useState('');
  const [backgroundPrompt, setBackgroundPrompt] = useState('');
  const [inSec, setInSec] = useState(0);
  const [outSec, setOutSec] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyGate, setKeyGate] = useState<KeyGateResult | null>(null);

  const win = clip ? clipActiveWindow(clip) : null;
  const surgeryOps = ops.filter(o => o.type === 'object-remove' || o.type === 'object-insert');

  const extractFrame = async () => {
    if (!clip || !win) return;
    setError(null);
    try {
      const dataUrl = await captureVideoFrame(clip, sourceOffset);
      setKeyframe(dataUrl);
      setPoint(null);
      // Default the range to [playhead, playhead + 3s] clamped to the clip's window.
      const start = Math.min(Math.max(currentTime, win.inSec), Math.max(win.inSec, win.outSec - 0.5));
      setInSec(Number(start.toFixed(2)));
      setOutSec(Number(Math.min(start + 3, win.outSec).toFixed(2)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pickPoint = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!keyframe) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setPoint({
      x: Number(((e.clientX - rect.left) / rect.width).toFixed(4)),
      y: Number(((e.clientY - rect.top) / rect.height).toFixed(4)),
    });
  };

  /** Journals the async lifecycle around one pipeline call: draft → applied/failed. */
  const journalRun = async (opId: string, runPipeline: () => Promise<SurgeryResult>) => {
    setBusy(true);
    try {
      const result = await runPipeline();
      dispatch({ type: 'set-op-status', opId, status: 'applied', resultUrl: result.resultUrl });
      onAbModeChange('segment');
    } catch (err) {
      // The pipeline already logged the reason to the LogPanel; keep the op failed.
      dispatch({ type: 'set-op-status', opId, status: 'failed' });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!clip || !win || busy) return;
    if (!keyframe) { setError('Extract a frame first.'); return; }
    if (!(outSec > inSec)) { setError('The range end must come after its start.'); return; }
    if (outSec > win.outSec || inSec < win.inSec) { setError(`Range must stay inside the clip's window (${win.inSec.toFixed(1)}s – ${win.outSec.toFixed(1)}s).`); return; }
    if (mode === 'remove' && !point) { setError('Click the object to remove on the extracted frame.'); return; }
    if (mode === 'insert' && !description.trim()) { setError('Describe the object to insert.'); return; }
    setError(null);

    // Paid feature: without a key, show the Connect-provider card before any op is journaled.
    const gate = evaluateKeyGate('object-surgery', readProviderKeyStatus());
    if (!gate.ok) { setKeyGate(gate); return; }
    setKeyGate(null);

    if (mode === 'remove') {
      const op = createObjectRemoveOp(clip.id, inSec, outSec, {
        point: point!,
        backgroundPrompt: backgroundPrompt.trim() || undefined,
      });
      dispatch({ type: 'commit-op', op });
      await journalRun(op.id, () => runObjectRemove(clip, op));
      return;
    }
    const op = createObjectInsertOp(clip.id, inSec, outSec, { description: description.trim() });
    dispatch({ type: 'commit-op', op });
    await journalRun(op.id, () => runObjectInsert(clip, op));
  };

  const rejectOp = (opId: string) => dispatch({ type: 'remove-op', opId });

  return (
    <div className="fixed top-14 right-0 bottom-0 w-80 z-[90] bg-white border-l border-gray-200 shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50 shrink-0">
        <div className="flex items-center gap-2">
          <Eraser className="w-4 h-4 text-violet-500" />
          <span className="text-sm font-bold text-gray-800">Object Surgery</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {!clip && <p className="text-xs text-gray-500">Move the playhead over a clip to start.</p>}

        {/* Mode tabs */}
        {clip && (
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl text-xs font-medium">
            <button
              onClick={() => setMode('remove')}
              className={`flex-1 py-1.5 rounded-lg transition-colors ${mode === 'remove' ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500'}`}
            >
              Remove
            </button>
            <button
              onClick={() => setMode('insert')}
              className={`flex-1 py-1.5 rounded-lg transition-colors ${mode === 'insert' ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-500'}`}
            >
              Insert
            </button>
          </div>
        )}

        {/* Frame extraction + pick surface */}
        {clip && (
          <div className="space-y-2">
            <button
              onClick={extractFrame}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-violet-50 text-violet-600 text-xs font-semibold hover:bg-violet-100 transition-colors"
            >
              <Scan className="w-3.5 h-3.5" /> Extract frame at playhead
            </button>
            {keyframe && (
              <div
                onClick={pickPoint}
                title="Click the object"
                className="relative cursor-crosshair rounded-xl overflow-hidden border border-gray-200"
              >
                <img src={keyframe} alt="Extracted frame" className="w-full block" />
                {point && (
                  <span
                    className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-violet-500 ring-2 ring-white pointer-events-none"
                    style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Remove: background prompt. Insert: description. */}
        {clip && keyframe && mode === 'remove' && (
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Background prompt (optional)</label>
            <input
              value={backgroundPrompt}
              onChange={e => setBackgroundPrompt(e.target.value)}
              placeholder="empty road behind"
              className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <p className="mt-1 text-[10px] text-gray-400">Click the object on the frame to mark it.</p>
          </div>
        )}
        {clip && keyframe && mode === 'insert' && (
          <div>
            <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Object description</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="a red balloon"
              className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
        )}

        {/* Range */}
        {clip && keyframe && (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">From (s)</label>
              <input type="number" step={0.1} min={0} value={inSec} onChange={e => setInSec(Number(e.target.value))} className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">To (s)</label>
              <input type="number" step={0.1} min={0} value={outSec} onChange={e => setOutSec(Number(e.target.value))} className="w-full px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300" />
            </div>
          </div>
        )}

        {clip && keyframe && (
          <button
            onClick={run}
            disabled={busy}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {busy ? 'Generating segment…' : mode === 'remove' ? 'Remove object' : 'Insert object'}
          </button>
        )}

        {error && <p className="text-[11px] text-red-500 bg-red-50 rounded-lg px-2.5 py-1.5">{error}</p>}

        {keyGate && (
          <ConnectProviderCard
            gate={keyGate}
            onResolved={run}
            onDismiss={() => setKeyGate(null)}
          />
        )}

        {/* Applied surgery ops + A/B toggle */}
        {surgeryOps.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Segments ({surgeryOps.length})</span>
              <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg text-[10px] font-semibold">
                <button
                  onClick={() => onAbModeChange('source')}
                  className={`px-2 py-0.5 rounded-md transition-colors ${abMode === 'source' ? 'bg-white text-gray-700 shadow-sm' : 'text-gray-400'}`}
                >
                  A · Source
                </button>
                <button
                  onClick={() => onAbModeChange('segment')}
                  className={`px-2 py-0.5 rounded-md transition-colors ${abMode === 'segment' ? 'bg-white text-violet-600 shadow-sm' : 'text-gray-400'}`}
                >
                  B · Segment
                </button>
              </div>
            </div>
            {surgeryOps.map(op => (
              <div key={op.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-gray-50 rounded-lg text-[11px]">
                <div className="min-w-0">
                  <span className="font-semibold text-gray-700">{op.type === 'object-remove' ? 'Remove' : 'Insert'}</span>
                  <span className="text-gray-400"> {op.inSec.toFixed(1)}s–{op.outSec.toFixed(1)}s · </span>
                  <span className={op.status === 'applied' ? 'text-green-600' : op.status === 'failed' ? 'text-red-500' : 'text-amber-500'}>
                    {op.status === 'draft' ? 'generating…' : op.status}
                  </span>
                </div>
                <button onClick={() => rejectOp(op.id)} title="Reject — restore source" className="shrink-0 p-1 rounded-md hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
