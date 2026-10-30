// Pure key-gate logic for the paid (generative) features. UI components read a
// live key snapshot (readProviderKeyStatus in ConnectProviderCard.tsx) and call
// evaluateKeyGate; this module never touches localStorage itself so it stays
// unit-testable and free of side effects.

export type ProviderKeyId = 'gemini' | 'groq' | 'fal' | 'meshy' | 'tripo';

export interface ProviderKeyStatus {
  gemini: boolean;
  groq: boolean;
  fal: boolean;
  meshy: boolean;
  tripo: boolean;
}

export type PaywalledFeature = 'style-bible' | 'voiceover-tts' | 'object-surgery' | 'image-to-3d';

export interface ProviderOfferSpec {
  id: ProviderKeyId;
  label: string;
  /** One line on what this provider contributes to the feature. */
  what: string;
  keyUrl: string;
  keyUrlLabel: string;
  placeholder: string;
  note: string;
}

export interface KeyGateResult {
  ok: boolean;
  feature: PaywalledFeature;
  featureLabel: string;
  featureBlurb: string;
  /** Offers to satisfy the gate, in preference order. Empty when ok. */
  offers: ProviderOfferSpec[];
}

export const PROVIDER_SPECS: Record<ProviderKeyId, ProviderOfferSpec> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    what: 'Handles generation with Gemini — free to start.',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyUrlLabel: 'aistudio.google.com/apikey',
    placeholder: 'Paste your Gemini API key',
    note: 'Free tier available',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    what: 'Free fallback that generates the Style Bible from your prompt.',
    keyUrl: 'https://console.groq.com/keys',
    keyUrlLabel: 'console.groq.com/keys',
    placeholder: 'Paste your Groq API key',
    note: 'Free tier available',
  },
  fal: {
    id: 'fal',
    label: 'fal.ai',
    what: 'Segments and inpaints your footage with SAM2 + VOID.',
    keyUrl: 'https://fal.ai/dashboard/keys',
    keyUrlLabel: 'fal.ai/dashboard/keys',
    placeholder: 'Paste your fal.ai key (FAL_KEY)',
    note: 'Pay per use',
  },
  meshy: {
    id: 'meshy',
    label: 'Meshy',
    what: 'Turns an extracted frame into a 3D model you can keyframe.',
    keyUrl: 'https://app.meshy.ai/settings/api-keys',
    keyUrlLabel: 'app.meshy.ai/settings/api-keys',
    placeholder: 'Paste your Meshy API key',
    note: 'Free credits to start',
  },
  tripo: {
    id: 'tripo',
    label: 'Tripo',
    what: 'Alternative image-to-3D engine — same placement workflow.',
    keyUrl: 'https://app.tripo3d.ai/apikey',
    keyUrlLabel: 'app.tripo3d.ai/apikey',
    placeholder: 'Paste your Tripo API key',
    note: 'Free credits to start',
  },
};

interface FeatureRequirement {
  featureLabel: string;
  featureBlurb: string;
  /** Providers that satisfy the feature (any one), in preference order. */
  providers: ProviderKeyId[];
}

const FEATURE_REQUIREMENTS: Record<PaywalledFeature, FeatureRequirement> = {
  'style-bible': {
    featureLabel: 'Style Bible generation',
    featureBlurb: 'Generates a project-wide look — color grade, vignette, transitions — from a text prompt, optionally matched to a reference clip.',
    providers: ['gemini', 'groq'],
  },
  'voiceover-tts': {
    featureLabel: 'AI voiceover',
    featureBlurb: 'Turns your narration script into natural speech with Gemini text-to-speech.',
    providers: ['gemini'],
  },
  'object-surgery': {
    featureLabel: 'Object removal & insertion',
    featureBlurb: 'Segments the object you click and inpaints the footage across the range you picked (fal.ai, or Gemini as a fallback).',
    providers: ['fal', 'gemini'],
  },
  'image-to-3d': {
    featureLabel: '3D model generation',
    featureBlurb: 'Turns an extracted video frame into a 3D model you can place over your footage and keyframe.',
    providers: ['meshy', 'tripo'],
  },
};

/** Any one provider satisfying the feature unlocks it — matching the provider facades. */
export function evaluateKeyGate(feature: PaywalledFeature, status: ProviderKeyStatus): KeyGateResult {
  const req = FEATURE_REQUIREMENTS[feature];
  const ok = req.providers.some(p => status[p]);
  return {
    ok,
    feature,
    featureLabel: req.featureLabel,
    featureBlurb: req.featureBlurb,
    offers: ok ? [] : req.providers.map(p => PROVIDER_SPECS[p]),
  };
}
