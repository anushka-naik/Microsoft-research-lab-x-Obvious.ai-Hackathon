import { GoogleGenAI, Type, FileState } from "@google/genai";
import { startLog, finishLog } from "./logger";
import { getApiKey } from "./apiKey";
import { parseStyleBible } from "./styleBible";
import type { StyleBible } from "../state/editOps";

function getAI() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No Gemini API key set. Click the key icon in the header to add one.');
  return new GoogleGenAI({ apiKey });
}

// -------------------------------------------------------------------
// Files API — upload once, reuse URI across calls
// Cache key: `${file.name}::${file.size}` (stable for same file object)
// -------------------------------------------------------------------
const fileUriCache = new Map<string, string>();

async function getFileUri(file: File, logContext?: string): Promise<string> {
  const cacheKey = `${file.name}::${file.size}`;
  if (fileUriCache.has(cacheKey)) {
    console.debug(`[gemini] reusing cached URI for "${file.name}"`);
    return fileUriCache.get(cacheKey)!;
  }

  console.debug(`[gemini] uploading "${file.name}" (${(file.size / 1024).toFixed(1)} KB) via Files API…`);
  const uploaded = await getAI().files.upload({ file, config: { mimeType: file.type, displayName: file.name } });

  // Poll until ACTIVE (video/audio may take a few seconds to process)
  let fileInfo = uploaded;
  while (fileInfo.state === FileState.PROCESSING) {
    await new Promise(r => setTimeout(r, 1500));
    fileInfo = await getAI().files.get({ name: fileInfo.name! });
  }

  if (fileInfo.state === FileState.FAILED) {
    throw new Error(`File upload failed for "${file.name}": ${fileInfo.error?.message ?? 'unknown'}`);
  }

  const uri = fileInfo.uri!;
  fileUriCache.set(cacheKey, uri);
  console.debug(`[gemini] uploaded "${file.name}" → ${uri}`);
  return uri;
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------
function pcmBase64ToWavUrl(pcmBase64: string, sampleRate = 24000): string {
  const pcm = Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0));
  const numChannels = 1, bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const enc = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  enc(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); enc(8, 'WAVE');
  enc(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, numChannels, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true); v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitsPerSample, true);
  enc(36, 'data'); v.setUint32(40, dataSize, true);
  new Uint8Array(buf, 44).set(pcm);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

function getAudioDuration(url: string): Promise<number> {
  return new Promise(resolve => {
    const a = new Audio(url);
    a.onloadedmetadata = () => resolve(a.duration);
    a.onerror = () => resolve(0);
  });
}

// -------------------------------------------------------------------
// Public API functions
// -------------------------------------------------------------------

export async function generateAudioFromScript(
  script: string,
  voiceName = 'Aoede'
): Promise<{ url: string; duration: number; transcription: string }> {
  const MODEL = 'gemini-2.5-flash-preview-tts';
  const log = startLog('TTS Generate', MODEL, `voice=${voiceName} | "${script.slice(0, 80)}${script.length > 80 ? '…' : ''}"`);
  try {
    const response = await getAI().models.generateContent({
      model: MODEL,
      contents: [{ parts: [{ text: script }] }],
      config: {
        responseModalities: ['AUDIO'] as any,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } as any,
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0] as any;
    if (!part?.inlineData?.data) throw new Error('No audio returned from TTS');

    const url = pcmBase64ToWavUrl(part.inlineData.data);
    const duration = await getAudioDuration(url);
    finishLog(log);
    return { url, duration, transcription: script };
  } catch (err: any) {
    finishLog(log, err?.message ?? String(err));
    throw err;
  }
}

export async function generateNarrationFromVideos(
  videoClips: Array<{ name: string; analysis: string; duration: number }>,
  voiceName = 'Aoede'
): Promise<{ url: string; duration: number; transcription: string }> {
  const MODEL = 'gemini-2.5-flash-lite';
  const totalDuration = videoClips.reduce((s, c) => s + c.duration, 0);
  const log = startLog('Generate Narration Script', MODEL, `${videoClips.length} clips | total ${totalDuration.toFixed(1)}s`);
  try {
    const scriptResponse = await getAI().models.generateContent({
      model: MODEL,
      contents: `You are a documentary narrator. Based on these video clips, write a natural, engaging narration script.
The total video duration is ${totalDuration.toFixed(1)} seconds — keep your script roughly the same length when spoken at a natural pace.
Do NOT include stage directions, timestamps, or labels. Output only the words to be spoken.

Video clips:
${videoClips.map((c, i) => `Clip ${i + 1} (${c.duration.toFixed(1)}s) — "${c.name}": ${c.analysis}`).join('\n')}`,
    });

    const script = scriptResponse.text?.trim() || 'No narration could be generated.';
    finishLog(log);
    return generateAudioFromScript(script, voiceName);
  } catch (err: any) {
    finishLog(log, err?.message ?? String(err));
    throw err;
  }
}

// Estimate segment timings locally — split text into sentences and distribute
// total duration proportionally by character count. Fast (0 ms, no LLM call).
export function estimateSegments(
  text: string,
  totalDuration: number
): Array<{ text: string; start: number; end: number }> {
  const sentences = (text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?\s][^.!?]*$/g) ?? [text])
    .map(s => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return [{ text, start: 0, end: totalDuration }];

  const totalChars = sentences.reduce((s, t) => s + t.length, 0);
  const segments: Array<{ text: string; start: number; end: number }> = [];
  let cursor = 0;

  for (let i = 0; i < sentences.length; i++) {
    const segDuration = (sentences[i].length / totalChars) * totalDuration;
    const end = i === sentences.length - 1 ? totalDuration : parseFloat((cursor + segDuration).toFixed(3));
    segments.push({ text: sentences[i], start: parseFloat(cursor.toFixed(3)), end });
    cursor = end;
  }
  return segments;
}

export async function analyzeVoiceover(
  audioFile: File
): Promise<{ transcription: string; segments: Array<{ text: string; start: number; end: number }> }> {
  // gemini-2.5-flash-lite: same model as analyzeVideo — fast, cheap
  const MODEL = 'gemini-2.5-flash-lite';
  const log = startLog('Analyze Voiceover', MODEL, audioFile.name);
  try {
    // Upload + measure duration in parallel
    const audioBlobUrl = URL.createObjectURL(audioFile);
    const [fileUri, totalDuration] = await Promise.all([
      getFileUri(audioFile),
      getAudioDuration(audioBlobUrl).finally(() => URL.revokeObjectURL(audioBlobUrl)),
    ]);

    // Ask only for transcription text — no timestamps, no schema, no JSON mode.
    // Timestamps are estimated locally (estimateSegments) at zero extra cost.
    const response = await getAI().models.generateContent({
      model: MODEL,
      contents: {
        parts: [
          { fileData: { mimeType: audioFile.type, fileUri } },
          { text: 'Transcribe all spoken words in this audio exactly as spoken. Return only the transcription text with natural sentence punctuation. No labels, no timestamps, no commentary.' },
        ],
      },
      config: { temperature: 0 },
    });

    const transcription = response.text?.trim() ?? '';
    const segments = estimateSegments(transcription, totalDuration);
    finishLog(log);
    return { transcription, segments };
  } catch (err: any) {
    finishLog(log, err?.message ?? String(err));
    throw err;
  }
}

export async function analyzeVideo(videoFile: File): Promise<string> {
  const MODEL = 'gemini-2.5-flash-lite';
  const log = startLog('Analyze Video', MODEL, videoFile.name);
  try {
    const fileUri = await getFileUri(videoFile);

    const response = await getAI().models.generateContent({
      model: MODEL,
      contents: {
        parts: [
          { fileData: { mimeType: videoFile.type, fileUri } },
          { text: 'Describe the content of this video clip in detail. What is happening? What are the key visual elements?' },
        ],
      },
    });

    const result = response.text || 'No analysis available.';
    finishLog(log);
    return result;
  } catch (err: any) {
    finishLog(log, err?.message ?? String(err));
    throw err;
  }
}

export interface AlignmentEntry {
  id: string; // clip id for this position
  alternatives: Array<{ id: string; confidence: number; reason: string }>;
}

export async function suggestAlignment(
  voiceoverTranscription: string,
  videoClips: Array<{ id: string; name: string; analysis: string; duration?: number }>
): Promise<AlignmentEntry[]> {
  const MODEL = 'gemini-2.5-flash-lite';
  const log = startLog('Suggest Alignment', MODEL, `${videoClips.length} clips`);
  try {
    const prompt = `You are an expert video editor. Your task is to arrange video clips into the best playback order so the visuals naturally illustrate a voiceover narration.

VOICEOVER NARRATION (read this carefully — this is what will be heard):
"""
${voiceoverTranscription}
"""

VIDEO CLIPS (each has an id, a name, and a description of its visual content):
${videoClips.map((c, i) => `${i + 1}. id="${c.id}" | name="${c.name}" | duration=${(c.duration ?? 0).toFixed(2)}s\n   Visual content: ${c.analysis}`).join('\n\n')}

TASK:
Read the narration from start to finish. For each position in the playback sequence:
1. Choose the clip whose visual content BEST matches that part of the narration.
2. Also identify 1-2 alternative clips that could plausibly work at that position, with a confidence score (0.0–1.0) and a brief reason.

Rules:
- Every clip must appear in the primary sequence exactly once.
- Alternatives may reference ANY other clip (including ones used elsewhere in the primary sequence).
- Order positions from first to last in playback order.

Return a JSON array with one object per position, each containing:
- "id": the primary clip id for this position
- "alternatives": array of { "id", "confidence" (0.0-1.0), "reason" (≤12 words) }`;

    const response = await getAI().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              alternatives: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                    reason: { type: Type.STRING },
                  },
                  required: ['id', 'confidence', 'reason'],
                },
              },
            },
            required: ['id', 'alternatives'],
          },
        },
      },
    });

    const entries: AlignmentEntry[] = JSON.parse(response.text || '[]');
    finishLog(log);
    return entries;
  } catch (err: any) {
    finishLog(log, err?.message ?? String(err));
    throw err;
  }

}

/**
 * Generate the project Style Bible from a text description, optionally
 * grounded in a reference clip's visual style ("match this reference" = same
 * flow with the file attached). Validated through parseStyleBible — a
 * structurally invalid response throws so the UI can offer a retry.
 */
export async function generateStyleBible(description: string, referenceFile?: File): Promise<StyleBible> {
  const MODEL = 'gemini-2.5-flash-lite';
  const context = referenceFile ? ` | reference: ${referenceFile.name}` : '';
  const log = startLog('Generate Style Bible', MODEL, `"${description.slice(0, 80)}${description.length > 80 ? '…' : ''}"${context}`);
  try {
    const parts: Array<{ text: string } | { fileData: { mimeType: string; fileUri: string } }> = [];
    if (referenceFile) {
      const fileUri = await getFileUri(referenceFile);
      parts.push({ fileData: { mimeType: referenceFile.type, fileUri } });
    }
    parts.push({ text: `You are a colorist and video style director. Create a Style Bible: a single JSON spec every clip in the project must follow, so exports look consistent.

${referenceFile
  ? 'A reference clip is attached — derive the visual style (color temperature, contrast, mood, pacing) from it first, then honor the written request where it adds detail.'
  : 'No reference clip attached — work from the written description alone.'}

Style request: """${description || 'A clean, modern, slightly cinematic look.'}"""

Field semantics (respect these exactly):
- grade.brightness/contrast/saturation: multipliers, 1 = neutral (usable range 0-2).
- grade.temperature: -1 (cool/blue) to 1 (warm/orange), 0 = neutral.
- grade.vignette: 0 (none) to 1 (heavy), drawn as a radial darkening.
- captions: burned-in caption typography defaults.
- transitions.allowed: subset of cut, fade, dissolve, wipe; defaultDurationSec in seconds (0-5).
- pacing: avgCutLengthSec and minCutLengthSec in seconds (avgCut >= minCut).
- overlayTypography: font/weight/color for text overlays; shadow adds a drop shadow.` });

    const response = await getAI().models.generateContent({
      model: MODEL,
      contents: { parts },
      config: {
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            grade: {
              type: Type.OBJECT,
              properties: {
                brightness: { type: Type.NUMBER },
                contrast: { type: Type.NUMBER },
                saturation: { type: Type.NUMBER },
                temperature: { type: Type.NUMBER },
                vignette: { type: Type.NUMBER },
              },
              required: ['brightness', 'contrast', 'saturation', 'temperature', 'vignette'],
            },
            captions: {
              type: Type.OBJECT,
              properties: {
                font: { type: Type.STRING },
                fontSize: { type: Type.NUMBER },
                color: { type: Type.STRING },
                bg: { type: Type.STRING },
                position: { type: Type.STRING, enum: ['bottom', 'top'] },
                mode: { type: Type.STRING, enum: ['lower-third', 'word-highlight', 'speaker-labeled'] },
              },
              required: ['font', 'fontSize', 'color', 'bg', 'position', 'mode'],
            },
            transitions: {
              type: Type.OBJECT,
              properties: {
                allowed: { type: Type.ARRAY, items: { type: Type.STRING, enum: ['cut', 'fade', 'dissolve', 'wipe'] } },
                defaultDurationSec: { type: Type.NUMBER },
              },
              required: ['allowed', 'defaultDurationSec'],
            },
            pacing: {
              type: Type.OBJECT,
              properties: {
                avgCutLengthSec: { type: Type.NUMBER },
                minCutLengthSec: { type: Type.NUMBER },
              },
              required: ['avgCutLengthSec', 'minCutLengthSec'],
            },
            overlayTypography: {
              type: Type.OBJECT,
              properties: {
                font: { type: Type.STRING },
                weight: { type: Type.NUMBER },
                color: { type: Type.STRING },
                shadow: { type: Type.BOOLEAN },
              },
              required: ['font', 'weight', 'color', 'shadow'],
            },
          },
          required: ['grade', 'captions', 'transitions', 'pacing', 'overlayTypography'],
        },
      },
    });

    const bible = parseStyleBible(response.text || '');
    if (!bible) throw new Error('Model returned an invalid Style Bible — try again or adjust the description.');
    finishLog(log);
    return bible;
  } catch (err: any) {
    finishLog(log, err?.message ?? String(err));
    throw err;
  }
}
