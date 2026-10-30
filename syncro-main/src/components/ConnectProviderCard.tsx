import { useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, X } from 'lucide-react';
import { hasProviderKey, setProviderKey } from '../services/apiKey';
import { hasMeshyApiKey, setMeshyApiKey, hasTripoApiKey, setTripoApiKey } from '../services/providers/apiKeys';
import type { KeyGateResult, ProviderKeyStatus, ProviderKeyId, ProviderOfferSpec } from '../utils/providerGate';

/** Live snapshot of every provider key, read from the existing localStorage stores. */
export function readProviderKeyStatus(): ProviderKeyStatus {
  return {
    gemini: hasProviderKey('gemini'),
    groq: hasProviderKey('groq'),
    fal: hasProviderKey('fal'),
    meshy: hasMeshyApiKey(),
    tripo: hasTripoApiKey(),
  };
}

/** Writes through the existing per-browser localStorage key stores — one setter per provider. */
function saveProviderKey(provider: ProviderKeyId, key: string): void {
  switch (provider) {
    case 'gemini': setProviderKey('gemini', key); break;
    case 'groq': setProviderKey('groq', key); break;
    case 'fal': setProviderKey('fal', key); break;
    case 'meshy': setMeshyApiKey(key); break;
    case 'tripo': setTripoApiKey(key); break;
  }
}

interface ConnectProviderCardProps {
  gate: KeyGateResult;
  /** Called once the gate flips to satisfied — resumes the action the user tried. */
  onResolved: () => void;
  onDismiss?: () => void;
}

/**
 * Inline "Connect a provider" card for the missing-key path of paid features.
 * Explains what the feature does, links directly to each provider's key page,
 * stores the key through the existing localStorage mechanism, and resumes the
 * interrupted action on success — never a dead error toast.
 */
export function ConnectProviderCard({ gate, onResolved, onDismiss }: ConnectProviderCardProps) {
  const [values, setValues] = useState<Partial<Record<ProviderKeyId, string>>>({});
  const [savingProvider, setSavingProvider] = useState<ProviderKeyId | null>(null);
  const [connected, setConnected] = useState(false);

  const save = async (offer: ProviderOfferSpec) => {
    const key = (values[offer.id] ?? '').trim();
    if (!key) return;
    setSavingProvider(offer.id);
    // Yield a frame so the button state paints before the (synchronous) store write.
    await new Promise(r => requestAnimationFrame(() => r(null)));
    saveProviderKey(offer.id, key);
    setSavingProvider(null);
    setConnected(true);
    // Resume the user's action after a beat so the connected state is visible.
    setTimeout(onResolved, 600);
  };

  return (
    <div
      data-testid="connect-provider-card"
      className="rounded-2xl border border-violet-200 bg-violet-50/80 p-4 space-y-3"
      role="dialog"
      aria-label={`Connect a provider for ${gate.featureLabel}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-violet-600 rounded-lg flex items-center justify-center shrink-0">
            <KeyRound className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-800">Connect a provider</p>
            <p className="text-[11px] text-gray-500">{gate.featureLabel} needs an API key</p>
          </div>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200/60 transition-colors" aria-label="Dismiss">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-gray-500">{gate.featureBlurb}</p>

      {connected ? (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-500 py-1">
          <CheckCircle2 className="w-4 h-4" /> Key saved — resuming…
        </p>
      ) : (
        gate.offers.map((offer, idx) => (
          <div key={offer.id} className="space-y-2">
            {idx > 0 && <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 pt-1">or use a fallback</p>}
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-gray-700">{offer.label}</p>
                <p className="text-[10px] text-gray-400">{offer.what}</p>
              </div>
              <a
                href={offer.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[10px] font-semibold text-violet-500 hover:text-violet-600 whitespace-nowrap"
              >
                {offer.keyUrlLabel} <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={values[offer.id] ?? ''}
                onChange={e => setValues(prev => ({ ...prev, [offer.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') void save(offer); }}
                placeholder={offer.placeholder}
                autoComplete="off"
                className="flex-1 min-w-0 text-xs px-3 py-2 rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 text-gray-700 placeholder:text-gray-400"
              />
              <button
                onClick={() => void save(offer)}
                disabled={!(values[offer.id] ?? '').trim() || savingProvider !== null}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                {savingProvider === offer.id
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <CheckCircle2 className="w-3.5 h-3.5" />}
                Save & continue
              </button>
            </div>
            <p className="text-[10px] text-gray-400">{offer.note} · Stored only in this browser (localStorage) and sent directly to {offer.label}.</p>
          </div>
        ))
      )}
    </div>
  );
}
