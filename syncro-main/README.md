<div align="center">

# Syncro

**Frame-granular, non-destructive video editing in the browser.**

Trim, cut objects out of a time range, grade every clip with one Style Bible, insert 3D assets — and have the exported file match exactly what the preview showed.

[Live demo](https://0gxlvpm00w-8823.hosted.obvious.ai) · [Demo script](DEMO_SCRIPT.md)

</div>

---

Syncro is a browser-based video editor built around one idea: **every edit is a timestamped operation, and nothing ever mutates your source footage.** Clips, grades, object removals, and 3D inserts all live in an append-only journal that is replayed identically in preview and at export — so the exported video is the authoritative render of the edit, not a lossy approximation of it.

## Architecture

The whole app rests on two contracts.

**The EditOp journal.** A single reducer owns timeline state. Every user action — trim, move, transition, text overlay, object removal, style grade — appends an op of the form `{ type, clipId, inSec, outSec, params }` to the journal. Undo/redo is an index pointer into that history. Source clips are never mutated; deleting an op restores the original playback exactly.

**Shared frame evaluation.** A pure function, `applyOpsAtTime(clips, ops, t)`, answers one question for any timeline instant: *what should this frame look like?* It resolves which clip is active (respecting trims), then folds every op covering `t` into a single `FrameInstruction`. The preview rAF loop and the export canvas loop are thin consumers of that one function — so preview and export cannot disagree. Whatever you saw is what you get.

```
                    ┌──────────────────────────────┐
  user actions ───▶ │  EditOp journal (reducer)    │  append-only · undo/redo
                    └──────────────┬───────────────┘
                                   │  ops[]
                                   ▼
                    ┌──────────────────────────────┐
  any time t ─────▶ │  applyOpsAtTime(clips,ops,t) │  pure · deterministic · unit-tested
                    └──────┬───────────────┬───────┘
                           │ FrameInstruction
              ┌────────────┘               └────────────┐
              ▼                                         ▼
     preview (rAF, canvas)                    export (MediaRecorder, canvas)
     same instruction stream                  same instruction stream
```

On top of the journal sit the feature layers:

**Style Bible.** One JSON spec — grade (brightness, contrast, saturation, temperature, vignette), caption typography, transition vocabulary, pacing — generated from a text description or by analyzing a reference clip. Preview applies it as CSS filters; export applies the same values as canvas `ctx.filter` plus drawn overlays. Both read the same object, and a range-scoped `style-grade` op lets you exempt or restyle any stretch of the timeline.

**Object surgery.** Select a time range and a click-point (or a text description); Syncro isolates that segment, removes or replaces the object, and pre-renders the result to a blob video that the journal splices in over exactly `[inSec, outSec]`. Frames outside the range are untouched footage. Every generation gets an A/B toggle — accept it, retry it, or delete the op and get the original back.

**Frame → 3D → tracked insert.** Pick any frame, send it to an image-to-3D provider, receive a GLB, and edit it in an embedded three.js panel (position / rotation / scale / lighting, no download required). Placement is a time-ranged `overlay-model` op composited as a 2.5D element — perspective matched from the keyframe, graded by the Style Bible. This makes intentional, stylized inserts; it is deliberately not camera-solved VFX.

### Provider clients

Each generative capability sits behind one interface in `src/services/providers/`, so swapping a model is a config change, not a rewrite:

| Capability | Preferred | Fallback |
|---|---|---|
| Object removal / inpainting | fal.ai — SAM 2 segmentation + VOID video inpainting | Gemini image-edit on a held frame |
| Image-to-3D | Meshy | Tripo |
| Style Bible / LLM generation | Gemini (structured output) | Groq (OpenAI-compatible, free tier) |

Keys are bring-your-own and stay in your browser's `localStorage`; they are sent directly from the client to each provider and nowhere else. Enter them in the in-app key-entry UI (⚙ key panel), or preload them via `.env` — see [.env.example](.env.example).

## Run locally

Requires Node.js.

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts: `npm run build`, `npm run preview`, `npm run lint` (typecheck), `npm test` (Vitest over the pure layers).

## API keys

Enter keys in the app's key-entry UI, or set them in `.env` / `.env.local` (they are injected at build time via `vite.config.ts`). Nothing is required to launch — features degrade gracefully and tell you which key is missing.

| Key | Where to get it | What it powers | Without it |
|---|---|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Clip analysis, key moments, descriptions, Style Bible generation (structured output), voiceover generation, image-edit fallback for object surgery | Analysis, captions, and Style Bible generation are unavailable |
| `GROQ_API_KEY` | Free at [console.groq.com](https://console.groq.com/keys) | Style Bible generation fallback (OpenAI-compatible endpoint) | Style Bible generation requires Gemini instead |
| `FAL_KEY` | [fal.ai](https://fal.ai/dashboard/keys) | SAM 2 + VOID video inpainting for time-ranged object removal | Object removal falls back to the Gemini image-edit path (lower quality) |
| `MESHY_API_KEY` | [Meshy](https://www.meshy.ai/dashboard/api-keys) | Frame → 3D asset generation (image-to-3D) | 3D insert falls back to Tripo |
| `TRIPO_API_KEY` | [Tripo](https://www.tripos3d.com/) | Image-to-3D fallback | 3D insert requires Meshy |

## Demo

Three-minute click-path with a pre-demo checklist: [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

🔗 [Obvious Project](https://app.obvious.ai/p/repo-code-integration-DZ2cwUEq) · 🧵 [Obvious Thread](https://app.obvious.ai/p/repo-code-integration-DZ2cwUEq?thread=th_58qqqGul) · 🔀 [Obvious PR Artifact](https://app.obvious.ai/prs?prRef=repo-code-addition-and-build-task:todo_buVPd4VV)
